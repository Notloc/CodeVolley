#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { getRepoRoot } from "./git.js";
import { createApp } from "./server.js";

// Design doc: fixed default port, deliberately off the beaten path
// (3000/5173/8000/8080/5000/4200 are common local-dev squatters).
const DEFAULT_PORT = 4877;

function parseRepoFlag(argv: string[]): string | undefined {
  const idx = argv.indexOf("--repo");
  return idx !== -1 ? argv[idx + 1] : undefined;
}

async function main() {
  const port = Number(process.env.CODEVOLLEY_PORT ?? DEFAULT_PORT);
  const repoFlag = parseRepoFlag(process.argv.slice(2));
  const repoRoot = await getRepoRoot(repoFlag ?? process.cwd()).catch((err) => {
    console.error(`codevolley: not a git repository (${(err as Error).message})`);
    process.exit(1);
  });

  const app = createApp(repoRoot, port);

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`CodeVolley daemon listening on http://localhost:${info.port}`);
    console.log(`Repo: ${repoRoot}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `codevolley: port ${port} is already in use. If another CodeVolley daemon is already running for this repo, you're done — nothing more to start. Otherwise set CODEVOLLEY_PORT to pick a different port.`,
      );
    } else {
      console.error(`codevolley: failed to start — ${err.message}`);
    }
    process.exit(1);
  });
}

main();
