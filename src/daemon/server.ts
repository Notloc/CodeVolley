import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { CreateReviewRequestSchema, GetReviewRequestSchema } from "../shared/internal-api.js";
import { createReview, getReview, GitError } from "./reviews-service.js";

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

export function createApp(repoRoot: string, port: number): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/internal/reviews", async (c) => {
    const parsed = CreateReviewRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    try {
      const result = await createReview(repoRoot, parsed.data, port);
      return c.json(result, 201);
    } catch (err) {
      if (err instanceof GitError) {
        return c.json({ error: `${err.message}: ${err.stderr}` }, 400);
      }
      throw err;
    }
  });

  app.get("/internal/reviews/:idOrTitle", async (c) => {
    const statusParam = c.req.query("status");
    const parsed = GetReviewRequestSchema.safeParse({
      review: c.req.param("idOrTitle"),
      status: statusParam ? statusParam.split(",") : undefined,
      path: c.req.query("path") ?? null,
    });
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const result = await getReview(repoRoot, parsed.data);
    if (!result.ok) {
      return c.json({ error: result.error }, 404);
    }
    return c.json(result.review, 200);
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
