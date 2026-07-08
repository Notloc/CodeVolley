import {
  ApiErrorSchema,
  type CloseReviewRequest,
  type CloseReviewResponse,
  CloseReviewResponseSchema,
  type CreateReviewRequest,
  type CreateReviewResponse,
  CreateReviewResponseSchema,
  type CreateThreadRequest,
  type CreateThreadResponse,
  CreateThreadResponseSchema,
  type EditCommentRequest,
  type EditCommentResponse,
  EditCommentResponseSchema,
  type GetReviewRequest,
  type GetReviewResponse,
  GetReviewResponseSchema,
  type PostNoteRequest,
  type PostNoteResponse,
  PostNoteResponseSchema,
  type ReopenReviewRequest,
  type ReopenReviewResponse,
  ReopenReviewResponseSchema,
  type ReplyRequest,
  type ReplyResponse,
  ReplyResponseSchema,
  type SetStatusRequest,
  type SetStatusResponse,
  SetStatusResponseSchema,
  type SubmitRevisionRequest,
  type SubmitRevisionResponse,
  SubmitRevisionResponseSchema,
  type WaitForActivityRequest,
  type WaitForActivityResponse,
  WaitForActivityResponseSchema,
} from "../shared/internal-api.js";

const DAEMON_URL = `http://localhost:${process.env.CODEVOLLEY_PORT ?? 4877}`;

// The adapter never spawns the daemon (design doc: "Two processes, not
// one") — this is the error every proxied tool call surfaces when it can't
// reach it, per §6.
export class DaemonUnreachableError extends Error {
  constructor() {
    super(
      "CodeVolley's UI daemon isn't running for this repo. Start it with `codevolley serve` from the repo root, then retry this call.",
    );
  }
}

export class DaemonApiError extends Error {}

async function callDaemon(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${DAEMON_URL}${path}`, init);
  } catch {
    throw new DaemonUnreachableError();
  }
  const body: unknown = await res.json();
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new DaemonApiError(parsed.success ? parsed.data.error : `Daemon returned HTTP ${res.status}`);
  }
  return body;
}

export async function createReview(req: CreateReviewRequest): Promise<CreateReviewResponse> {
  const body = await callDaemon("/internal/reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return CreateReviewResponseSchema.parse(body);
}

export async function getReview(req: GetReviewRequest): Promise<GetReviewResponse> {
  const params = new URLSearchParams();
  if (req.status) params.set("status", req.status.join(","));
  if (req.path) params.set("path", req.path);
  const qs = params.toString();
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}${qs ? `?${qs}` : ""}`);
  return GetReviewResponseSchema.parse(body);
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function createThread(req: CreateThreadRequest): Promise<CreateThreadResponse> {
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}/threads`, jsonPost(req));
  return CreateThreadResponseSchema.parse(body);
}

export async function reply(req: ReplyRequest): Promise<ReplyResponse> {
  const body = await callDaemon(
    `/internal/reviews/${encodeURIComponent(req.review)}/threads/${encodeURIComponent(req.thread)}/replies`,
    jsonPost(req),
  );
  return ReplyResponseSchema.parse(body);
}

export async function editComment(req: EditCommentRequest): Promise<EditCommentResponse> {
  const body = await callDaemon(
    `/internal/reviews/${encodeURIComponent(req.review)}/threads/${encodeURIComponent(req.thread)}/comments/${encodeURIComponent(req.comment)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
  );
  return EditCommentResponseSchema.parse(body);
}

export async function setStatus(req: SetStatusRequest): Promise<SetStatusResponse> {
  const body = await callDaemon(
    `/internal/reviews/${encodeURIComponent(req.review)}/threads/${encodeURIComponent(req.thread)}/status`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
  );
  return SetStatusResponseSchema.parse(body);
}

export async function postNote(req: PostNoteRequest): Promise<PostNoteResponse> {
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}/notes`, jsonPost(req));
  return PostNoteResponseSchema.parse(body);
}

export async function closeReview(req: CloseReviewRequest): Promise<CloseReviewResponse> {
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}/close`, jsonPost(req));
  return CloseReviewResponseSchema.parse(body);
}

export async function reopenReview(req: ReopenReviewRequest): Promise<ReopenReviewResponse> {
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}/reopen`, jsonPost(req));
  return ReopenReviewResponseSchema.parse(body);
}

export async function submitRevision(req: SubmitRevisionRequest): Promise<SubmitRevisionResponse> {
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}/revisions`, jsonPost(req));
  return SubmitRevisionResponseSchema.parse(body);
}

export async function waitForActivity(req: WaitForActivityRequest): Promise<WaitForActivityResponse> {
  const params = new URLSearchParams({ after: String(req.after) });
  if (req.timeout_seconds !== undefined) params.set("timeout_seconds", String(req.timeout_seconds));
  const body = await callDaemon(`/internal/reviews/${encodeURIComponent(req.review)}/wait?${params.toString()}`);
  return WaitForActivityResponseSchema.parse(body);
}
