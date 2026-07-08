import { z } from "zod";
import { CommentSchema, EventSchema, NoteKindSchema, RevisionFileSchema, ReviewSchema, SeveritySchema, SideSchema, ThreadStatusSchema } from "./types.js";

// Request/response contracts for the adapter -> daemon internal HTTP API.
// The MCP adapter proxies each tool call to these; keeping them as a shared
// schema module means adapter and daemon can never drift on the wire shape.

export const CreateReviewRequestSchema = z.object({
  title: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1).default("WORKTREE"),
  paths: z.array(z.string()).optional(),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const CreateReviewResponseSchema = z.object({
  id: z.string(),
  url: z.string(),
  revision: z.number().int().positive(),
  files: z.array(RevisionFileSchema),
  lastSeq: z.number().int().nonnegative(),
});
export type CreateReviewResponse = z.infer<typeof CreateReviewResponseSchema>;

export const GetReviewRequestSchema = z.object({
  review: z.string().min(1),
  status: z.array(ThreadStatusSchema).optional(),
  path: z.string().nullable().optional(),
});
export type GetReviewRequest = z.infer<typeof GetReviewRequestSchema>;

export const GetReviewResponseSchema = ReviewSchema;
export type GetReviewResponse = z.infer<typeof GetReviewResponseSchema>;

export const CreateThreadRequestSchema = z.object({
  review: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  end_line: z.number().int().positive().nullable().optional(),
  side: SideSchema.optional(),
  severity: SeveritySchema,
  title: z.string().min(1),
  body: z.string(),
  suggestion: z.string().nullable().optional(),
});
export type CreateThreadRequest = z.infer<typeof CreateThreadRequestSchema>;

export const CreateThreadResponseSchema = z.object({ thread: z.string() });
export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;

export const ReplyRequestSchema = z.object({
  review: z.string().min(1),
  thread: z.string().min(1),
  body: z.string(),
  status: ThreadStatusSchema.optional(),
});
export type ReplyRequest = z.infer<typeof ReplyRequestSchema>;

export const ReplyResponseSchema = z.object({ thread: z.string(), status: ThreadStatusSchema });
export type ReplyResponse = z.infer<typeof ReplyResponseSchema>;

export const EditCommentRequestSchema = z.object({
  review: z.string().min(1),
  thread: z.string().min(1),
  comment: z.string().min(1),
  body: z.string(),
});
export type EditCommentRequest = z.infer<typeof EditCommentRequestSchema>;

export const EditCommentResponseSchema = z.object({ thread: z.string(), comments: z.array(CommentSchema) });
export type EditCommentResponse = z.infer<typeof EditCommentResponseSchema>;

export const SetStatusRequestSchema = z.object({
  review: z.string().min(1),
  thread: z.string().min(1),
  status: ThreadStatusSchema,
});
export type SetStatusRequest = z.infer<typeof SetStatusRequestSchema>;

export const SetStatusResponseSchema = z.object({ thread: z.string(), status: ThreadStatusSchema });
export type SetStatusResponse = z.infer<typeof SetStatusResponseSchema>;

export const PostNoteRequestSchema = z.object({
  review: z.string().min(1),
  kind: NoteKindSchema,
  body: z.string(),
});
export type PostNoteRequest = z.infer<typeof PostNoteRequestSchema>;

export const PostNoteResponseSchema = z.object({ note: z.string() });
export type PostNoteResponse = z.infer<typeof PostNoteResponseSchema>;

export const CloseReviewRequestSchema = z.object({
  review: z.string().min(1),
  summary: z.string(),
});
export type CloseReviewRequest = z.infer<typeof CloseReviewRequestSchema>;

export const CloseReviewResponseSchema = z.object({ review: z.string(), status: z.literal("closed") });
export type CloseReviewResponse = z.infer<typeof CloseReviewResponseSchema>;

export const ReopenReviewRequestSchema = z.object({
  review: z.string().min(1),
});
export type ReopenReviewRequest = z.infer<typeof ReopenReviewRequestSchema>;

export const ReopenReviewResponseSchema = z.object({ review: z.string(), status: z.literal("open") });
export type ReopenReviewResponse = z.infer<typeof ReopenReviewResponseSchema>;

// Design doc §3: default timeout 90s, hard cap 100s (must return before the
// MCP client's own tool-call timeout kills the call — see the `.mcp.json`
// `timeout` note in the design doc's "Startup and registration" section).
export const WAIT_FOR_ACTIVITY_DEFAULT_TIMEOUT_SECONDS = 90;
export const WAIT_FOR_ACTIVITY_MAX_TIMEOUT_SECONDS = 100;

export const WaitForActivityRequestSchema = z.object({
  review: z.string().min(1),
  after: z.number().int().nonnegative(),
  timeout_seconds: z.number().int().positive().optional(),
});
export type WaitForActivityRequest = z.infer<typeof WaitForActivityRequestSchema>;

export const WaitForActivityResponseSchema = z.object({
  events: z.array(EventSchema),
  lastSeq: z.number().int().nonnegative(),
  timedOut: z.boolean(),
});
export type WaitForActivityResponse = z.infer<typeof WaitForActivityResponseSchema>;

// UI-only: full file content is deliberately excluded from get_review's
// response (RevisionFileSchema has no content field — see shared/types.ts)
// since Claude never needs it. The browser fetches it separately, per file.
export const GetFileContentRequestSchema = z.object({
  review: z.string().min(1),
  revision: z.number().int().positive(),
  path: z.string().min(1),
});
export type GetFileContentRequest = z.infer<typeof GetFileContentRequestSchema>;

export const GetFileContentResponseSchema = z.object({
  path: z.string(),
  status: RevisionFileSchema.shape.status,
  oldPath: z.string().optional(),
  oldContent: z.string().nullable(),
  newContent: z.string().nullable(),
});
export type GetFileContentResponse = z.infer<typeof GetFileContentResponseSchema>;

export const SubmitRevisionRequestSchema = z.object({
  review: z.string().min(1),
  message: z.string(),
  base: z.string().min(1).optional(),
  head: z.string().min(1).optional(),
  paths: z.array(z.string()).optional(),
});
export type SubmitRevisionRequest = z.infer<typeof SubmitRevisionRequestSchema>;

export const SubmitRevisionResponseSchema = z.object({
  revision: z.number().int().positive(),
  files: z.array(RevisionFileSchema),
  reanchored: z.array(z.object({ thread: z.string(), line: z.number().int().positive() })),
  outdated: z.array(z.string()),
});
export type SubmitRevisionResponse = z.infer<typeof SubmitRevisionResponseSchema>;

// Structured error body the daemon returns for any failed internal call —
// mirrors design doc §6 (errors should teach, not just fail).
export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
