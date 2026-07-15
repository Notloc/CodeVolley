import { createHash } from "node:crypto";

// Content-addressed blob pool for a review. Full file contents are stored once
// per review, keyed by hash, and each revision's files reference them instead
// of embedding their own copy. Without this, submit_revision re-embeds the full
// old+new content of every file in every revision — so a review's on-disk size
// grew linearly with its revision count even when nothing changed (a 10-revision
// review of a few large files ballooned to tens of MB, enough to choke IDE
// text search). Revisions are immutable and append-only, so blobs are only ever
// added, never orphaned — no garbage collection needed.

export function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

// Interns content into the pool, returning its hash ref — or null for an absent
// side (added files have no old content, deleted files no new content, binary
// files neither).
export function internContent(blobs: Record<string, string>, content: string | null): string | null {
  if (content === null) return null;
  const ref = hashContent(content);
  if (!(ref in blobs)) blobs[ref] = content;
  return ref;
}

export function resolveContent(blobs: Record<string, string>, ref: string | null): string | null {
  if (ref === null) return null;
  return blobs[ref] ?? null;
}
