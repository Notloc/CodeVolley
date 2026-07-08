import type { StoredReview, StoredThread } from "./storage-types.js";

// Thread/comment/note ids are sequential counters scoped to their parent
// (design doc §1: "t-4", "c-1", "n-2"), tracked on _threadSeq/_noteSeq/
// _commentSeq rather than array length — edit_comment truncates comments,
// and length-based numbering would let a truncated-away id get reissued.
export function nextThreadId(review: StoredReview): string {
  review._threadSeq += 1;
  return `t-${review._threadSeq}`;
}

export function nextNoteId(review: StoredReview): string {
  review._noteSeq += 1;
  return `n-${review._noteSeq}`;
}

export function nextCommentId(thread: StoredThread): string {
  thread._commentSeq += 1;
  return `c-${thread._commentSeq}`;
}
