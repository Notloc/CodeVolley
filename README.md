# CodeVolley

Local MCP server + web UI for collaborative, thread-based code review between Claude and a developer.

CodeVolley runs entirely on your machine against a local git repository. Claude reviews your changes and leaves inline comment threads; you read, reply, and resolve them in a web UI — and Claude picks up your replies live. Nothing leaves your machine.

## How it works

CodeVolley is **two processes**, not one:

- **UI daemon** — owns the review store (`.codevolley/`), serves the web UI, and streams live updates. Long-running; you start it manually and leave it up. Binds `http://localhost:4877` by default.
- **MCP adapter** — a stdio MCP server that Claude Code launches. It proxies Claude's review tools to the daemon over HTTP. It never starts the daemon itself — if the daemon isn't running, tool calls fail with an error naming the start command.

The daemon owns the repo; the adapter is stateless and just talks to `localhost:4877`. So pointing the daemon at a different repo is all you need — Claude's tools follow.

## Prerequisites

- **Node.js 18+**
- A **git repository** to review (the daemon requires the target to be a git repo)
- **[Claude Code](https://claude.com/claude-code)** for the reviewer side (to register the MCP adapter)

## Setup

Clone CodeVolley somewhere (it lives outside the repos you review). The web UI is a **separate npm package** with its own dependencies, so install in both places:

```bash
npm install                 # daemon + adapter deps
npm install --prefix web    # web UI deps  (don't skip this)
npm run build               # compiles the daemon/adapter (dist/) and the web UI (web/dist/)
npm link                    # puts the `codevolley` and `codevolley-mcp` commands on your PATH
```

`npm link` symlinks the built binaries globally so you can run `codevolley` from any repo. (Prefer not to link? See [Running without `npm link`](#running-without-npm-link).)

## Running the UI daemon

From **inside the repo you want to review**:

```bash
cd /path/to/your/repo
codevolley serve
```

Then open **http://localhost:4877**.

To review a repo without `cd`-ing into it, pass `--repo`:

```bash
codevolley serve --repo /path/to/your/repo
```

Notes:
- The daemon is long-running and independent of any Claude session — leave it up as long as you want the UI reachable.
- Default port is **4877**. Override with `CODEVOLLEY_PORT` (e.g. `CODEVOLLEY_PORT=4878 codevolley serve`). Only one daemon can hold a port at a time.
- If the target isn't a git repo, it exits with `codevolley: not a git repository`.

### Running without `npm link`

If you'd rather not link globally, call the built entry point directly and point it at your repo:

```bash
node /absolute/path/to/CodeVolley/dist/daemon/cli.js --repo /path/to/your/repo
```

(`npm run serve` also works, but only from the CodeVolley directory itself — it reviews CodeVolley's own repo, so it's really just for developing CodeVolley.)

## Connecting Claude Code

Register the adapter as an MCP server (it's a stdio server, no repo argument — it finds the daemon on `localhost:4877`). With the `npm link` from setup, the `codevolley-mcp` command is on your PATH:

```bash
claude mcp add codevolley -- codevolley-mcp
```

- Add `--scope project` to write a shared `.mcp.json` committed with the repo, instead of the default local scope.
- If the daemon runs on a non-default port, pass it through: `claude mcp add codevolley --env CODEVOLLEY_PORT=4878 -- codevolley-mcp`.
- Didn't `npm link`? Use the absolute path instead: `claude mcp add codevolley -- node /absolute/path/to/CodeVolley/dist/adapter/index.js`.
- Verify with `claude mcp list` (or `/mcp` in a session). Tools surface as `mcp__CodeVolley__*`.

The daemon must be running for the tools to work; if it's down, a tool call fails with an error naming `codevolley serve`, and starting it unblocks the next call — no session restart needed.

## Typical flow

1. Start the daemon in your repo (`npm run serve`), keep the browser open at `http://localhost:4877`.
2. In Claude Code (with the adapter registered), ask Claude to review your changes. It computes a merge-base, creates a review, and posts inline threads.
3. Read/reply/resolve threads in the web UI. Claude picks up your replies via its wait loop and responds. Use **Fix it!** on a thread to ask Claude to just take the obvious action.
4. State persists in `.codevolley/`, so a later session resumes the same review.

## Data & persistence

Reviews are stored as JSON under **`.codevolley/`** at the repo root. It's gitignored by default — treat it as local, per-developer state.

## Customizing the file tree (optional)

By default the file tree lists every changed file flat. You can group it into named sections per workspace by adding **`.codevolley/config.json`** to the repo you review:

```json
{
  "sections": [
    { "name": "Database", "pattern": "src/db/",    "priority": 1 },
    { "name": "Java",     "pattern": "src/com/",    "priority": 2 },
    { "name": "Vue",      "pattern": "**/*.vue",    "priority": 3 },
    { "name": "Tests",    "pattern": "**/*.test.*", "priority": 4 }
  ]
}
```

- **`priority`** orders sections ascending — `1` shows first. Each file lands in the first section it matches; anything unmatched falls into a trailing **Other** group. The file tree and the diff stack both follow this grouping/order.
- **`pattern`** with no wildcard is a directory/exact prefix (`src/db/` matches `src/db/foo.ts`, not `src/database.ts`). With wildcards it's a glob: `*` stays within a path segment, `**` spans separators (`**/*.vue`, `src/db/**`).
- Does nothing until configured. It's fetched once when the UI loads, so **refresh the page** after editing. Lives under the gitignored `.codevolley/`, so it's local per-developer — un-ignore just that file if you want to share it with the team.

Once sections are configured, each header in the file tree can be **collapsed** (click the header) and **soloed** (click the eye icon to filter the tree and diff view down to just that section; click again to clear).

## Development

```bash
npm run dev:daemon    # daemon with reload (tsx watch)
npm run typecheck     # type-check the daemon/adapter
npm test              # vitest
```

The daemon serves the **built** web assets from `web/dist/`, so after changing the frontend, re-run `npm run build:web` (or run Vite separately in `web/` for HMR).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Compile daemon/adapter (`dist/`) + build web UI (`web/dist/`) |
| `npm run build:web` | Build just the web UI |
| `npm run serve` | Start the daemon against CodeVolley's *own* repo (dev only — use `codevolley serve` from your target repo instead) |
| `npm run dev:daemon` | Daemon with file-watch reload |
| `npm run dev:adapter` | Run the MCP adapter from source |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the test suite |

## Further reading

- [`INTERACTIVE-REVIEW-MCP.md`](INTERACTIVE-REVIEW-MCP.md) — the full design doc (architecture, tool contracts, re-anchoring semantics).
- [`docs/split-view.md`](docs/split-view.md) — notes on the deferred side-by-side diff view.
