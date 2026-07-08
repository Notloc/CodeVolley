import {
  ApiErrorSchema,
  type CreateReviewRequest,
  type CreateReviewResponse,
  CreateReviewResponseSchema,
  type GetReviewRequest,
  type GetReviewResponse,
  GetReviewResponseSchema,
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
