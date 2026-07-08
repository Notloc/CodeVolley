import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type WorkspaceConfig, WorkspaceConfigSchema } from "../shared/internal-api.js";
import {
  type ReviewIndex,
  ReviewIndexSchema,
  type StoredReview,
  StoredReviewSchema,
} from "./storage-types.js";
import { notifyReviewActivity } from "./waiters.js";

function codevolleyDir(repoRoot: string): string {
  return path.join(repoRoot, ".codevolley");
}

// Optional per-workspace UI config. Missing file → empty config; a malformed
// one is logged and treated as empty so it never breaks the UI.
export async function readWorkspaceConfig(repoRoot: string): Promise<WorkspaceConfig> {
  const file = path.join(codevolleyDir(repoRoot), "config.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { sections: [] };
  }
  try {
    return WorkspaceConfigSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error(`codevolley: ignoring invalid .codevolley/config.json — ${(err as Error).message}`);
    return { sections: [] };
  }
}

function reviewsDir(repoRoot: string): string {
  return path.join(codevolleyDir(repoRoot), "reviews");
}

function reviewFilePath(repoRoot: string, id: string): string {
  return path.join(reviewsDir(repoRoot), `${id}.json`);
}

function indexFilePath(repoRoot: string): string {
  return path.join(codevolleyDir(repoRoot), "index.json");
}

// Write-to-temp-then-rename: `rename` is atomic on a POSIX filesystem
// (macOS/Linux both qualify) as long as source and destination share a
// filesystem, which they do here since the temp file is a sibling.
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await rename(tmpPath, filePath);
}

async function readJsonIfExists(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readReview(repoRoot: string, id: string): Promise<StoredReview | null> {
  const raw = await readJsonIfExists(reviewFilePath(repoRoot, id));
  if (raw === null) return null;
  return StoredReviewSchema.parse(raw);
}

export async function readIndex(repoRoot: string): Promise<ReviewIndex> {
  const raw = await readJsonIfExists(indexFilePath(repoRoot));
  if (raw === null) return [];
  return ReviewIndexSchema.parse(raw);
}

async function writeIndex(repoRoot: string, index: ReviewIndex): Promise<void> {
  await atomicWriteJson(indexFilePath(repoRoot), index);
}

// Persists the review and keeps its index entry (id/title/status/createdAt)
// in sync in the same call — every write goes through here so the two never
// drift apart.
export async function writeReview(repoRoot: string, review: StoredReview): Promise<void> {
  await atomicWriteJson(reviewFilePath(repoRoot, review.id), review);

  const index = await readIndex(repoRoot);
  const entry = {
    id: review.id,
    title: review.title,
    status: review.status,
    createdAt: review.createdAt,
  };
  const existingIdx = index.findIndex((e) => e.id === review.id);
  if (existingIdx === -1) {
    index.push(entry);
  } else {
    index[existingIdx] = entry;
  }
  await writeIndex(repoRoot, index);

  // Wakes any wait_for_activity long-polls on this review now that the new
  // state is durably on disk (not before — a waiter re-reads from disk).
  notifyReviewActivity(review.id);
}

// Tools accept id or title (design doc §1). Exact id match wins; falls back
// to an exact, case-insensitive title match. Returns null if neither hits —
// callers turn that into the structured "unknown review" error (§6), which
// needs the full index to list valid ids/titles.
export async function resolveReviewId(repoRoot: string, idOrTitle: string): Promise<string | null> {
  const index = await readIndex(repoRoot);
  const byId = index.find((e) => e.id === idOrTitle);
  if (byId) return byId.id;
  const byTitle = index.find((e) => e.title.toLowerCase() === idOrTitle.toLowerCase());
  return byTitle ? byTitle.id : null;
}

// Recovers from a stale/corrupt index.json (e.g. hand-edited or interrupted
// mid-write) by rebuilding it straight from the review files on disk.
export async function rebuildIndex(repoRoot: string): Promise<ReviewIndex> {
  let files: string[];
  try {
    files = await readdir(reviewsDir(repoRoot));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const index: ReviewIndex = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.includes(".tmp-")) continue;
    const id = file.slice(0, -".json".length);
    const review = await readReview(repoRoot, id);
    if (review) {
      index.push({ id: review.id, title: review.title, status: review.status, createdAt: review.createdAt });
    }
  }
  await writeIndex(repoRoot, index);
  return index;
}
