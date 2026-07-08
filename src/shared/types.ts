import { z } from "zod";

export const ActorSchema = z.enum(["claude", "user"]);
export type Actor = z.infer<typeof ActorSchema>;

export const SeveritySchema = z.enum(["issue", "suggestion", "question", "nit", "praise"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const ThreadStatusSchema = z.enum(["open", "resolved", "wontfix"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const ReviewStatusSchema = z.enum(["open", "closed"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const SideSchema = z.enum(["NEW", "OLD"]);
export type Side = z.infer<typeof SideSchema>;

// Design doc §2: added | modified | deleted | renamed | binary.
// binary files skip full-content capture entirely — no diff, no thread-anchoring.
export const FileStatusSchema = z.enum(["added", "modified", "deleted", "renamed", "binary"]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const AnchorStateSchema = z.enum(["current", "outdated"]);
export type AnchorState = z.infer<typeof AnchorStateSchema>;

export const NoteKindSchema = z.enum(["progress", "summary", "note"]);
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const EventTypeSchema = z.enum([
  "thread_created",
  "comment_added",
  "comment_edited",
  "thread_status_changed",
  "thread_attention_cleared",
  "note_added",
  "revision_submitted",
  "user_done",
  "review_closed",
  "review_reopened",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  author: ActorSchema,
  body: z.string(),
  createdAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const AnchorSchema = z.object({
  revision: z.number().int().positive(),
  path: z.string(),
  side: SideSchema,
  line: z.number().int().positive(),
  endLine: z.number().int().positive().nullable(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const ThreadSchema = z.object({
  id: z.string(),
  severity: SeveritySchema,
  status: ThreadStatusSchema,
  title: z.string(),
  anchor: AnchorSchema,
  currentAnchor: AnchorSchema,
  anchorState: AnchorStateSchema,
  suggestion: z.string().nullable(),
  comments: z.array(CommentSchema),
  // True when there's user input on this thread that Claude hasn't handled:
  // set by user comments/creation, cleared when Claude replies or explicitly
  // acknowledges. Independent of status (open/resolved/wontfix). Defaulted so
  // reviews persisted before this field load cleanly.
  awaitingClaude: z.boolean().default(false),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  author: ActorSchema,
  kind: NoteKindSchema,
  body: z.string(),
  createdAt: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

// Tool-facing file summary — no content. Full old/new content + hunks are
// daemon-internal storage (see daemon/storage-types.ts), fetched by the web
// UI through a separate endpoint, never shipped through an MCP tool result.
export const RevisionFileSchema = z.object({
  path: z.string(),
  status: FileStatusSchema,
  oldPath: z.string().optional(),
  // Hash of the file's old+new content, stable across revisions when the
  // file didn't actually change — lets the UI skip refetching/re-diffing
  // untouched files on submit_revision. Optional: absent on revisions
  // persisted before this field existed.
  contentHash: z.string().optional(),
});
export type RevisionFile = z.infer<typeof RevisionFileSchema>;

export const RevisionSchema = z.object({
  number: z.number().int().positive(),
  message: z.string().nullable(),
  base: z.string(),
  head: z.string(),
  paths: z.array(z.string()),
  capturedAt: z.string(),
  files: z.array(RevisionFileSchema),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const EventSchema = z.object({
  seq: z.number().int().positive(),
  createdAt: z.string(),
  actor: ActorSchema,
  type: EventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
});
export type Event = z.infer<typeof EventSchema>;

export const ReviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: ReviewStatusSchema,
  createdAt: z.string(),
  url: z.string(),
  revisions: z.array(RevisionSchema),
  threads: z.array(ThreadSchema),
  notes: z.array(NoteSchema),
  lastSeq: z.number().int().nonnegative(),
});
export type Review = z.infer<typeof ReviewSchema>;
