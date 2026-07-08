import { z } from "zod";
import { RevisionFileSchema, ReviewSchema, ThreadStatusSchema } from "./types.js";

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

// Structured error body the daemon returns for any failed internal call —
// mirrors design doc §6 (errors should teach, not just fail).
export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
