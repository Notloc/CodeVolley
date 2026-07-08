import { generateReviewId } from "../shared/id.js";
import type { CreateReviewRequest, CreateReviewResponse, GetReviewRequest } from "../shared/internal-api.js";
import { RevisionFileSchema, type Review } from "../shared/types.js";
import { captureDiff, GitError } from "./git.js";
import { readIndex, readReview, resolveReviewId, writeReview } from "./persistence.js";
import { projectReview, type StoredReview, type StoredRevision } from "./storage-types.js";

export { GitError };

export async function createReview(
  repoRoot: string,
  req: CreateReviewRequest,
  port: number,
): Promise<CreateReviewResponse> {
  const capture = await captureDiff(repoRoot, req.base, req.head, req.paths ?? []);

  let id: string;
  for (;;) {
    id = generateReviewId();
    if (!(await readReview(repoRoot, id))) break;
  }

  const now = new Date().toISOString();
  const url = `http://localhost:${port}/review/${id}`;

  const revision: StoredRevision = {
    number: 1,
    message: null,
    base: capture.resolvedBase,
    head: capture.resolvedHead,
    paths: req.paths ?? [],
    capturedAt: now,
    files: capture.files,
  };

  const review: StoredReview = {
    id,
    title: req.title,
    status: "open",
    createdAt: now,
    url,
    revisions: [revision],
    threads: [],
    notes: [],
    events: [],
    lastSeq: 0,
    _threadSeq: 0,
    _noteSeq: 0,
  };

  await writeReview(repoRoot, review);

  return {
    id,
    url,
    revision: 1,
    files: RevisionFileSchema.array().parse(revision.files),
    lastSeq: 0,
  };
}

export type GetReviewResult = { ok: true; review: Review } | { ok: false; error: string };

export async function getReview(repoRoot: string, req: GetReviewRequest): Promise<GetReviewResult> {
  const id = await resolveReviewId(repoRoot, req.review);
  if (!id) {
    const index = await readIndex(repoRoot);
    const known = index.map((e) => `${e.id} ("${e.title}")`).join(", ") || "(none)";
    return { ok: false, error: `Unknown review "${req.review}". Known reviews: ${known}` };
  }

  const stored = await readReview(repoRoot, id);
  if (!stored) {
    return { ok: false, error: `Review "${id}" is indexed but its file is missing from .codevolley/reviews/.` };
  }

  const wantsFilter = req.status !== undefined || (req.path !== undefined && req.path !== null);
  const filtered: StoredReview = wantsFilter
    ? {
        ...stored,
        threads: stored.threads.filter(
          (t) =>
            (req.status === undefined || req.status.includes(t.status)) &&
            (req.path === undefined || req.path === null || t.anchor.path === req.path || t.currentAnchor.path === req.path),
        ),
      }
    : stored;

  return { ok: true, review: projectReview(filtered) };
}
