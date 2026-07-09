import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  AcknowledgeThreadRequestSchema,
  CloseReviewRequestSchema,
  CreateReviewRequestSchema,
  CreateThreadRequestSchema,
  EditCommentRequestSchema,
  GetFileContentRequestSchema,
  GetReviewRequestSchema,
  PostNoteRequestSchema,
  ReopenReviewRequestSchema,
  ReplyRequestSchema,
  SetStatusRequestSchema,
  SubmitRevisionRequestSchema,
  WaitForActivityRequestSchema,
} from "../shared/internal-api.js";
import type { Actor } from "../shared/types.js";
import { NotFoundError, ReviewClosedError, ValidationError } from "./errors.js";
import { GitError } from "./git.js";
import {
  acknowledgeThread,
  closeReview,
  createReview,
  createThread,
  editComment,
  getFileContent,
  getPresence,
  getReview,
  getReviewEvents,
  listReviews,
  markUserDone,
  postNote,
  reopenReview,
  reply,
  resolveAndReadReview,
  setStatus,
  submitRevision,
  waitForActivity,
} from "./reviews-service.js";
import { readWorkspaceConfig } from "./persistence.js";
import { recordHeartbeat, waitForReviewActivity } from "./waiters.js";

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
    // Vite fingerprints everything under /assets, so those are safe to cache
    // forever; index.html (which points at the current fingerprints) must be
    // revalidated or browsers keep loading stale bundles after a rebuild.
    const cacheControl = cleanPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return new Response(new Uint8Array(data), { headers: { "Content-Type": contentType, "Cache-Control": cacheControl } });
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

// Registers the write routes shared by both actors — the MCP adapter hits
// these under /internal (actor "claude"), the browser hits the identical
// shapes under /api (actor "user"). Actor is a closure argument, never
// client-supplied, so neither caller can spoof the other's identity.
function registerReviewWriteRoutes(app: Hono, repoRoot: string, prefix: string, actor: Actor): void {
  app.post(`${prefix}/reviews/:idOrTitle/threads`, async (c) => {
    const parsed = CreateThreadRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => createThread(repoRoot, parsed.data, actor), 201);
  });

  app.post(`${prefix}/reviews/:idOrTitle/threads/:threadId/replies`, async (c) => {
    const parsed = ReplyRequestSchema.safeParse({
      ...(await c.req.json()),
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => reply(repoRoot, parsed.data, actor));
  });

  app.patch(`${prefix}/reviews/:idOrTitle/threads/:threadId/comments/:commentId`, async (c) => {
    const parsed = EditCommentRequestSchema.safeParse({
      ...(await c.req.json()),
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
      comment: c.req.param("commentId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => editComment(repoRoot, parsed.data, actor));
  });

  app.put(`${prefix}/reviews/:idOrTitle/threads/:threadId/status`, async (c) => {
    const parsed = SetStatusRequestSchema.safeParse({
      ...(await c.req.json()),
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => setStatus(repoRoot, parsed.data, actor));
  });

  app.post(`${prefix}/reviews/:idOrTitle/threads/:threadId/acknowledge`, async (c) => {
    const parsed = AcknowledgeThreadRequestSchema.safeParse({
      review: c.req.param("idOrTitle"),
      thread: c.req.param("threadId"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => acknowledgeThread(repoRoot, parsed.data, actor));
  });

  app.post(`${prefix}/reviews/:idOrTitle/notes`, async (c) => {
    const parsed = PostNoteRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => postNote(repoRoot, parsed.data, actor), 201);
  });

  app.post(`${prefix}/reviews/:idOrTitle/close`, async (c) => {
    const parsed = CloseReviewRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => closeReview(repoRoot, parsed.data, actor));
  });
}

export function createApp(repoRoot: string, port: number): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Adapter liveness ping — records that a Claude session is connected so the
  // UI can distinguish "working" from "no session running".
  app.post("/internal/heartbeat", (c) => {
    recordHeartbeat();
    return c.json({ ok: true });
  });

  app.get("/internal/reviews", (c) => handled(c, () => listReviews(repoRoot)));

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

  registerReviewWriteRoutes(app, repoRoot, "/internal", "claude");
  registerReviewWriteRoutes(app, repoRoot, "/api", "user");

  app.post("/internal/reviews/:idOrTitle/reopen", async (c) => {
    const parsed = ReopenReviewRequestSchema.safeParse({ review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => reopenReview(repoRoot, parsed.data, "claude"));
  });

  app.post("/internal/reviews/:idOrTitle/revisions", async (c) => {
    const parsed = SubmitRevisionRequestSchema.safeParse({ ...(await c.req.json()), review: c.req.param("idOrTitle") });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => submitRevision(repoRoot, parsed.data, "claude"), 201);
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

  app.get("/api/reviews/:idOrTitle/revisions/:number/file", async (c) => {
    const parsed = GetFileContentRequestSchema.safeParse({
      review: c.req.param("idOrTitle"),
      revision: Number(c.req.param("number")),
      path: c.req.query("path"),
    });
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    return handled(c, () => getFileContent(repoRoot, parsed.data));
  });

  app.get("/api/config", (c) => handled(c, () => readWorkspaceConfig(repoRoot)));

  app.get("/api/reviews/:idOrTitle/presence", (c) => handled(c, () => getPresence(repoRoot, c.req.param("idOrTitle"))));

  app.get("/api/reviews/:idOrTitle/events", (c) => handled(c, () => getReviewEvents(repoRoot, c.req.param("idOrTitle"))));

  // UI-only: the "Done for now" button (§5). No MCP tool mirrors this — it's
  // inherently a user action; Claude just observes it via wait_for_activity.
  app.post("/api/reviews/:idOrTitle/done", async (c) => {
    return handled(c, () => markUserDone(repoRoot, c.req.param("idOrTitle")));
  });

  // Live event stream for the browser (§5 "Liveness"). Unlike
  // wait_for_activity, this sends every event regardless of actor — the UI
  // needs to see Claude's own threads/notes stream in, not just the user's.
  app.get("/api/reviews/:idOrTitle/stream", (c) => {
    const idOrTitle = c.req.param("idOrTitle");
    let after = Number(c.req.query("after") ?? 0);

    return streamSSE(c, async (stream) => {
      let aborted = false;
      stream.onAbort(() => {
        aborted = true;
      });

      while (!aborted) {
        let review;
        try {
          review = await resolveAndReadReview(repoRoot, idOrTitle);
        } catch {
          break; // review deleted/renamed out from under the stream — just end it
        }

        for (const event of review.events.filter((e) => e.seq > after)) {
          await stream.writeSSE({ data: JSON.stringify(event), event: event.type, id: String(event.seq) });
          after = event.seq;
        }
        if (aborted) break;

        await waitForReviewActivity(review.id, 30_000); // 30s cap just to re-check periodically, not a real deadline
      }
    });
  });

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
