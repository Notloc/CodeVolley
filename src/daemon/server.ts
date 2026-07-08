import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, Hono } from "hono";
import {
  CloseReviewRequestSchema,
  CreateReviewRequestSchema,
  CreateThreadRequestSchema,
  EditCommentRequestSchema,
  GetReviewRequestSchema,
  PostNoteRequestSchema,
  ReopenReviewRequestSchema,
  ReplyRequestSchema,
  SetStatusRequestSchema,
  SubmitRevisionRequestSchema,
  WaitForActivityRequestSchema,
} from "../shared/internal-api.js";
import { NotFoundError, ReviewClosedError, ValidationError } from "./errors.js";
import { GitError } from "./git.js";
import {
  closeReview,
  createReview,
  createThread,
  editComment,
  getReview,
  postNote,
  reopenReview,
  reply,
  setStatus,
  submitRevision,
  waitForActivity,
} from "./reviews-service.js";

// The daemon's cwd is the *reviewed* repo, not CodeVolley's own install
// location — @hono/node-server's serveStatic only supports cwd-relative
// roots, which doesn't work here, so we resolve the web build's absolute
// path from this module's own location instead. `src/daemon` and (compiled)
// `dist/daemon` are both two levels below the project root, so the same
// `../../web/dist` works in dev and in the built artifact.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST_DIR = path.resolve(MODULE_DIR, "../../web/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

async function serveStaticAsset(requestPath: string): Promise<Response | null> {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.join(WEB_DIST_DIR, cleanPath);
  if (!filePath.startsWith(WEB_DIST_DIR)) return null; // guards against path traversal (e.g. "/../../etc/passwd")
  try {
    const data = await readFile(filePath);
    const contentType = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), { headers: { "Content-Type": contentType } });
  } catch {
    return null;
  }
}

// Maps service-layer errors to HTTP status per design doc §6. `actor` is
// never client-supplied — every /internal/* route is only ever called by
// the trusted local MCP adapter, so it's hardcoded "claude" here rather than
// trusted from the request body (a future browser-write endpoint would live
// under a separate route prefix with actor hardcoded to "user" instead).
async function handled<T>(c: Context, fn: () => Promise<T>, successStatus: 200 | 201 = 200): Promise<Response> {
  try {
    const result = await fn();
    return c.json(result as object, successStatus);
  } catch (err) {
    if (err instanceof GitError) return c.json({ error: `${err.message}: ${err.stderr}` }, 400);
    if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof ReviewClosedError) return c.json({ error: err.message }, 409);
    throw err;
  }
}

export function createApp(repoRoot: string, port: number): Hono {
  const app = new Hono();
  const ACTOR = "claude" as const;

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/internal/reviews", async (c) => {
    const parsed = CreateReviewRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => createReview(repoRoot, parsed.data, port), 201);
  });

  app.get("/internal/reviews/:idOrTitle", async (c) => {
    const statusParam = c.req.query("status");
    const parsed = GetReviewRequestSchema.safeParse({
      review: c.req.param("idOrTitle"),
      status: statusParam ? statusParam.split(",") : undefined,
      path: c.req.query("path") ?? null,
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const result = await getReview(repoRoot, parsed.data);
    if (!result.ok) return c.json({ error: result.error }, 404);
    return c.json(result.review, 200);
  });

  app.post("/internal/reviews/:idOrTitle/threads", async (c) => {
    const parsed = CreateThreadRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => createThread(repoRoot, parsed.data, ACTOR), 201);
  });

  app.post("/internal/reviews/:idOrTitle/threads/:threadId/replies", async (c) => {
    const parsed = ReplyRequestSchema.safeParse({
      ...(await c.req.json()),
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => reply(repoRoot, parsed.data, ACTOR));
  });

  app.patch("/internal/reviews/:idOrTitle/threads/:threadId/comments/:commentId", async (c) => {
    const parsed = EditCommentRequestSchema.safeParse({
      ...(await c.req.json()),
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
      comment: c.req.param("commentId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => editComment(repoRoot, parsed.data, ACTOR));
  });

  app.put("/internal/reviews/:idOrTitle/threads/:threadId/status", async (c) => {
    const parsed = SetStatusRequestSchema.safeParse({
      ...(await c.req.json()),
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => setStatus(repoRoot, parsed.data, ACTOR));
  });

  app.post("/internal/reviews/:idOrTitle/notes", async (c) => {
    const parsed = PostNoteRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => postNote(repoRoot, parsed.data, ACTOR), 201);
  });

  app.post("/internal/reviews/:idOrTitle/close", async (c) => {
    const parsed = CloseReviewRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => closeReview(repoRoot, parsed.data, ACTOR));
  });

  app.post("/internal/reviews/:idOrTitle/reopen", async (c) => {
    const parsed = ReopenReviewRequestSchema.safeParse({ review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => reopenReview(repoRoot, parsed.data, ACTOR));
  });

  app.post("/internal/reviews/:idOrTitle/revisions", async (c) => {
    const parsed = SubmitRevisionRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => submitRevision(repoRoot, parsed.data, ACTOR), 201);
  });

  app.get("/internal/reviews/:idOrTitle/wait", async (c) => {
    const afterParam = c.req.query("after");
    const timeoutParam = c.req.query("timeout_seconds");
    const parsed = WaitForActivityRequestSchema.safeParse({
      review: c.req.param("idOrTitle"),
      after: afterParam !== undefined ? Number(afterParam) : undefined,
      timeout_seconds: timeoutParam !== undefined ? Number(timeoutParam) : undefined,
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => waitForActivity(repoRoot, parsed.data));
  });

  // SSE event stream lands here once the event log exists (follow-up work).
  // Everything else falls through to the built web UI, with an index.html
  // fallback for client-side routes (e.g. /review/:id) that aren't real files.
  app.get("*", async (c) => {
    const url = new URL(c.req.url);
    const asset = (await serveStaticAsset(url.pathname)) ?? (await serveStaticAsset("/index.html"));
    if (!asset) {
      return c.text("CodeVolley daemon is running, but the web UI hasn't been built yet (npm run build:web).", 200);
    }
    return asset;
  });

  return app;
}
