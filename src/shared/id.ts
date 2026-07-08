import { randomBytes } from "node:crypto";

// Review ids are short random slugs (design doc §1: "rv-a3f8"), regenerated
// by the caller on collision. Thread/comment/note ids are sequential
// counters scoped to their parent (t-4, c-1, n-2) — see daemon/storage-types.ts.
export function generateReviewId(): string {
  return `rv-${randomBytes(2).toString("hex")}`;
}
