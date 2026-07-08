// Local mirror of the fields this app needs from shared/types.ts. Duplicated
// rather than imported to keep the web build fully decoupled from the
// daemon's TS project (see App.tsx's original note on this tradeoff).

export type Actor = "claude" | "user";
export type Severity = "issue" | "suggestion" | "question" | "nit" | "praise";
export type ThreadStatus = "open" | "resolved" | "wontfix";
export type ReviewStatus = "open" | "closed";
export type Side = "NEW" | "OLD";
export type FileStatus = "added" | "modified" | "deleted" | "renamed" | "binary";
export type AnchorState = "current" | "outdated";
export type NoteKind = "progress" | "summary" | "note";

export interface Comment {
  id: string;
  author: Actor;
  body: string;
  createdAt: string;
}

export interface Anchor {
  revision: number;
  path: string;
  side: Side;
  line: number;
  endLine: number | null;
}

export interface Thread {
  id: string;
  severity: Severity;
  status: ThreadStatus;
  title: string;
  anchor: Anchor;
  currentAnchor: Anchor;
  anchorState: AnchorState;
  suggestion: string | null;
  comments: Comment[];
}

export interface Note {
  id: string;
  author: Actor;
  kind: NoteKind;
  body: string;
  createdAt: string;
}

export interface RevisionFile {
  path: string;
  status: FileStatus;
  oldPath?: string;
}

export interface Revision {
  number: number;
  message: string | null;
  base: string;
  head: string;
  paths: string[];
  capturedAt: string;
  files: RevisionFile[];
}

export interface Review {
  id: string;
  title: string;
  status: ReviewStatus;
  createdAt: string;
  url: string;
  revisions: Revision[];
  threads: Thread[];
  notes: Note[];
  lastSeq: number;
}

export type EventType =
  | "thread_created"
  | "comment_added"
  | "comment_edited"
  | "thread_status_changed"
  | "note_added"
  | "revision_submitted"
  | "user_done"
  | "review_closed"
  | "review_reopened";

export interface ReviewEvent {
  seq: number;
  createdAt: string;
  actor: Actor;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface FileContent {
  path: string;
  status: FileStatus;
  oldPath?: string;
  oldContent: string | null;
  newContent: string | null;
}
