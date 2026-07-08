import { z } from "zod";
import {
  EventSchema,
  RevisionFileSchema,
  RevisionSchema,
  ReviewSchema,
  ThreadSchema,
} from "../shared/types.js";

// Daemon-only on-disk shapes. Supersets of the tool-facing types in
// shared/types.ts — full file content for diff rendering, plus bookkeeping
// counters for id generation. Never returned directly from an MCP tool or
// the internal API; project down to the public shape with `projectReview`
// below, which relies on zod's default behavior of stripping unrecognized
// keys when parsing through the narrower public schema.

export const StoredRevisionFileSchema = RevisionFileSchema.extend({
  // null for added (oldContent), deleted (newContent), or binary (both) files.
  oldContent: z.string().nullable(),
  newContent: z.string().nullable(),
});
export type StoredRevisionFile = z.infer<typeof StoredRevisionFileSchema>;

export const StoredRevisionSchema = RevisionSchema.extend({
  files: z.array(StoredRevisionFileSchema),
});
export type StoredRevision = z.infer<typeof StoredRevisionSchema>;

export const StoredThreadSchema = ThreadSchema.extend({
  // Comment ids are "c-<n>" scoped to this counter, not comments.length —
  // edit_comment truncates the comments array, and reusing length would
  // let a truncated-away id get handed out again.
  _commentSeq: z.number().int().nonnegative(),
});
export type StoredThread = z.infer<typeof StoredThreadSchema>;

export const StoredReviewSchema = ReviewSchema.extend({
  revisions: z.array(StoredRevisionSchema),
  threads: z.array(StoredThreadSchema),
  events: z.array(EventSchema),
  _threadSeq: z.number().int().nonnegative(),
  _noteSeq: z.number().int().nonnegative(),
});
export type StoredReview = z.infer<typeof StoredReviewSchema>;

// Strips storage-only fields (full file content, _-prefixed counters, events)
// down to the tool-facing Review shape.
export function projectReview(stored: StoredReview) {
  return ReviewSchema.parse(stored);
}

export const ReviewIndexEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  status: ReviewSchema.shape.status,
  createdAt: z.string(),
});
export type ReviewIndexEntry = z.infer<typeof ReviewIndexEntrySchema>;

export const ReviewIndexSchema = z.array(ReviewIndexEntrySchema);
export type ReviewIndex = z.infer<typeof ReviewIndexSchema>;
