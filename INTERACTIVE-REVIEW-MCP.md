# Interactive Code Review — MCP Contract

**Status:** Draft for implementation · **Author:** Claude + Colton · **Date:** 2026-07-07
**Name:** `CodeVolley` (MCP server name `CodeVolley`, so tools surface as `mcp__CodeVolley__*`)

A local MCP server + web UI for collaborative, thread-based code review between Claude and a developer. Claude submits a diff and streams line-anchored comment threads as it reviews; the developer reads, replies, resolves, and opens threads of their own in the browser. Claude picks up UI activity through a long-polling wait tool, so the loop feels live without chat nudges.

Built in the mold of CodeCanon: a repo-local server launched via stdio MCP, an embedded HTTP server for the UI, JSON persistence in a dot-directory at the repo root.

---

## 1. Concepts

| Concept | Summary |
|---|---|
| **Review** | The unit of work. Owns revisions, threads, notes, and an event log. Resolved by id or title. Status `open` or `closed`. |
| **Revision** | An immutable snapshot of the diff under review (Gerrit "patchset" model). Numbered 1..n. Submitting a new revision never mutates an old one. |
| **Thread** | A conversation anchored to a line (or line range) of a file in a revision. Has a severity, a status, and an ordered list of comments. |
| **Comment** | One message in a thread. Author is `claude` or `user`. Body is markdown. |
| **Note** | A review-level message not anchored to any line — progress ticker entries, the final summary, or user directives ("skip the style stuff"). |
| **Event** | An append-only log entry with a monotonically increasing `seq`. The `wait_for_activity` cursor runs over this log. |

### Identity and persistence

- Reviews get short slug ids (server-generated). Tools accept id **or** title, CodeCanon-style.
- Persist everything as JSON under **`.codevolley/`** at the repo root (mirror `.codecanon/`; document that it should be gitignored).
- The server is git-aware: it runs `git` in the repo root to capture revisions. This is what makes side-by-side rendering and re-anchoring possible without Claude shipping file contents through tool calls.

### Two processes, not one

CodeVolley splits into two independently-running pieces rather than one process wearing both hats:

- **UI daemon** — owns `.codevolley/`, the embedded HTTP UI, and the SSE event stream. Long-running and independent of any Claude Code session. **Started manually** by the developer (e.g. `codevolley serve` from the repo root) and left running for as long as they want the UI reachable. Nothing auto-launches it — if you want to just browse a review, you don't need Claude Code open at all, as long as you started the daemon yourself.
- **MCP adapter** — the thin stdio process Claude Code spawns per session, one process per session per repo (stdio has no cross-session sharing, so one adapter can never serve two repos). It holds no state of its own: every tool call is proxied to the UI daemon's internal HTTP API (e.g. `POST /internal/threads`, `GET /internal/events?after=42` for `wait_for_activity`'s long poll) and the response translated back into an MCP tool result.

The adapter never spawns the daemon. If a tool call comes in and the daemon isn't reachable on its port, the call fails with a structured error (§6) naming the exact start command — Claude surfaces that to the user and retries once it's running. This check happens on every call, not just once at adapter startup, so starting the daemon mid-session unblocks the very next tool call with no session restart needed.

- The daemon binds a fixed default port — **4877**, chosen deliberately off the beaten path to avoid the usual local-dev squatters (3000, 5173, 8000, 8080, 5000, 4200, …). If it's already taken by something else, it fails to start with a clear error rather than silently picking a different one.
- The `.mcp.json` entry for the adapter must set an explicit `timeout` (ms). Claude Code's built-in per-call default is generous, but it's overridable globally via `MCP_TOOL_TIMEOUT`, and `wait_for_activity`'s long poll (§3) must never get clipped by it. Recommend `"timeout": 120000` — comfortably above the 100s long-poll cap.

---

## 2. Data model

Shapes below are the tool-facing JSON contract. Internal storage is the implementer's choice.

### Review

```jsonc
{
  "id": "rv-a3f8",
  "title": "ticket-27514 MSAPR module review",
  "status": "open",              // open | closed
  "createdAt": "…",
  "url": "http://localhost:4877/review/rv-a3f8",
  "revisions": [ /* Revision, ascending */ ],
  "threads":   [ /* Thread */ ],
  "notes":     [ /* Note */ ],
  "lastSeq": 42                   // highest event seq — hand to wait_for_activity
}
```

### Revision

```jsonc
{
  "number": 2,
  "message": "Fixes from threads t-4, t-7",
  "base": "8f21c0d",             // resolved SHA
  "head": "WORKTREE",            // resolved SHA, or the literal "WORKTREE"
  "paths": [":!vue/", ":!war/WEB-INF/jsp/", ":!war/WEB-INF/tags/"],
  "capturedAt": "…",
  "files": [
    { "path": "src/com/…/Foo.java", "status": "modified" }
    // status: added | modified | deleted | renamed | binary
    // renamed carries oldPath. binary files (detected via git) skip full-content
    // capture entirely — no diff, no thread-anchoring, just presence.
  ]
}
```

**Capture semantics.** The server runs `git diff <base> <head> -- <paths>` (worktree head = `git diff <base> -- <paths>`, which includes uncommitted changes) and stores, per changed file, the **full old and new content** plus computed hunks. Full content is required for side-by-side rendering and re-anchoring; hunk-only storage is insufficient. `base` is any committish — Claude computes merge-bases itself and passes the result; the server does not do merge-base logic.

**Worktree heads are snapshots.** When head is `WORKTREE`, content is captured at submit time. Later edits to the working tree do not change the revision — that's what `submit_revision` is for.

### Thread

```jsonc
{
  "id": "t-4",
  "severity": "issue",           // issue | suggestion | question | nit | praise
  "status": "open",              // open | resolved | wontfix
  "title": "Enum passed as toString()",
  "anchor": {                     // original anchor, never mutated
    "revision": 1,
    "path": "src/com/…/FooRepo.java",
    "side": "NEW",               // NEW | OLD
    "line": 118,
    "endLine": null               // optional range end (inclusive)
  },
  "currentAnchor": { "revision": 2, "line": 121, "…": "…" },
  "anchorState": "current",      // current | outdated
  "suggestion": "repo.getMany(scope, query, status);",  // optional replacement code for the anchored range
  "comments": [
    { "id": "c-1", "author": "claude", "body": "…markdown…", "createdAt": "…" },
    { "id": "c-2", "author": "user",   "body": "…", "createdAt": "…" }
  ]
}
```

Severity guide (aligns with the existing review skill's vocabulary): `issue` = should fix before merge; `suggestion` = consider / non-blocking improvement; `question` = reviewer needs information; `nit` = trivia, take or leave; `praise` = positive callout. The UI should style these distinctly and let the user filter by them.

Threads may anchor to **any line of any file present in the revision** (either side), not just changed lines — full content is stored, and reviewers legitimately comment on unchanged context. Anchoring to a file not in the revision is an error (see §6).

**Anchoring is independent of diff rendering.** An anchor is a position in the revision's base or head file content — never a position in a particular diff view. This is what allows the UI to offer view lenses (per-commit narrowing, §5) without invalidating threads: however the diff is sliced for display, every thread still lands on its line.

### Note

```jsonc
{ "id": "n-2", "author": "claude", "kind": "progress", "body": "Pass 1: repo layer — 3/9 files", "createdAt": "…" }
// kind: progress | summary | note
```

`progress` notes power the live status line in the UI (only the latest matters visually; keep history). `summary` is rendered prominently (opening plan, closing summary). `note` is everything else, including user-authored directives from the UI.

### Event

```jsonc
{ "seq": 43, "createdAt": "…", "actor": "user", "type": "comment_added", "payload": { /* see §4 */ } }
```

Types: `thread_created`, `comment_added`, `comment_edited`, `thread_status_changed`, `note_added`, `revision_submitted`, `user_done`, `review_closed`, `review_reopened`. Every state change appends an event, whichever side caused it.

---

## 3. MCP tools

Eleven tools. All take `review` (id or title) except `create_review`. Errors are structured (§6).

### `create_review`

Create a review **and capture revision 1** in one call.

```jsonc
// params
{
  "title": "ticket-27514 MSAPR module review",
  "base": "8f21c0d",             // required committish (pass a merge-base SHA for branch reviews)
  "head": "WORKTREE",            // optional committish, default "WORKTREE"
  "paths": [":!vue/"]            // optional git pathspecs
}
// result
{ "id": "rv-a3f8", "url": "…", "revision": 1, "files": [ …RevisionFileSummary ], "lastSeq": 1 }
```

The server should open (or offer) the URL; at minimum the tool result carries it so Claude can hand it to the user.

### `submit_revision`

Capture a new immutable revision and re-anchor open threads.

```jsonc
// params — base/head/paths default to the previous revision's values (WORKTREE is re-captured)
{ "review": "rv-a3f8", "message": "Fixes from threads t-4, t-7", "base": "…?", "head": "…?", "paths": ["…?"] }
// result
{
  "revision": 2,
  "files": [ … ],
  "reanchored": [ { "thread": "t-2", "line": 121 } ],
  "outdated":   [ "t-4", "t-7" ]   // re-anchor failed — Claude should re-inspect these
}
```

Submitting to a `closed` review reopens it (logged as an event).

**Re-anchoring (behavioral contract, implementation free):** for each thread not already `outdated`, locate the anchored line in the new revision by exact line-content match with surrounding-context corroboration (git-apply-style fuzz is the right mental model). Unambiguous match → update `currentAnchor`, keep `anchorState: current`. No match or ambiguous → `anchorState: outdated`; the thread keeps its original anchor and the UI shows it against the old revision's context under an "Outdated" grouping. `resolved`/`wontfix` threads may be skipped (mark `outdated` without search). The `outdated` list in the result is the important part: after a fix pass, it tells Claude exactly which threads to re-verify and resolve.

### `create_thread`

```jsonc
// params
{
  "review": "rv-a3f8",
  "path": "src/com/…/FooRepo.java",
  "line": 118,
  "end_line": null,              // optional
  "side": "NEW",                 // optional, default NEW
  "severity": "issue",
  "title": "Enum passed as toString()",
  "body": "…markdown, may include code blocks…",
  "suggestion": null              // optional replacement code for the anchored range
}
// result
{ "thread": "t-4" }
```

Anchors against the **latest revision**. `title` is the collapsed one-line summary in the UI; `body` is the full first comment.

### `reply`

```jsonc
// params
{ "review": "rv-a3f8", "thread": "t-4", "body": "…", "status": "resolved" }  // status optional — transition in the same call
// result
{ "thread": "t-4", "status": "resolved" }
```

### `edit_comment`

Edit a comment's body. Only the comment's own author may edit it — an MCP tool call is always actor `claude`, so this can only target Claude's own comments; the UI offers the equivalent for the user's own comments directly (not through this tool). Editing truncates the thread: every comment after the edited one is discarded, since later replies may have been responding to the old text — the same reasoning behind message-edit truncation in a chat transcript.

```jsonc
// params
{ "review": "rv-a3f8", "thread": "t-4", "comment": "c-2", "body": "…new markdown…" }
// result
{ "thread": "t-4", "comments": [ /* the thread's comments, post-truncation */ ] }
```

### `set_status`

Status change without a comment (the UI gives the user buttons for the same transitions).

```jsonc
// params
{ "review": "rv-a3f8", "thread": "t-4", "status": "wontfix" }   // open | resolved | wontfix
```

### `post_note`

```jsonc
// params
{ "review": "rv-a3f8", "kind": "progress", "body": "Pass 2: semantics review running" }
```

### `wait_for_activity`

The liveness primitive. Long-polls the event log for **user-actor events** past a cursor.

```jsonc
// params
{ "review": "rv-a3f8", "after": 42, "timeout_seconds": 90 }
// result — immediately if events already exist past `after`, else when one arrives, else at timeout
{ "events": [ { "seq": 43, "actor": "user", "type": "comment_added", "payload": { … } } ], "lastSeq": 43, "timedOut": false }
```

- Filters to `actor: user` — Claude knows its own actions and shouldn't be echoed. (`user_done` and user-side `review_closed` are user-actor and thus included.)
- Default timeout 90s; **cap at 100s** and document why: it must return before the MCP client's tool timeout kills the call. On timeout: `{ "events": [], "lastSeq": <unchanged>, "timedOut": true }` — Claude just calls again. The empty-timeout → re-call loop is the idle state of an interactive session.
- While a `wait_for_activity` call is open, the server knows Claude is parked: surface this in the UI (see §5, presence).

### `get_review`

Full state snapshot — the resume/recovery tool. A fresh Claude session reconstructs the entire review from one call.

```jsonc
// params
{ "review": "rv-a3f8", "status": ["open"], "path": null }   // optional thread filters; default: everything
// result: the Review shape from §2, threads filtered as requested, always with lastSeq
```

### `close_review`

```jsonc
// params
{ "review": "rv-a3f8", "summary": "…markdown closing summary…" }
```

Posts the summary as a `summary` note, sets status `closed`, UI shows a closed banner with the summary. The user can also close from the UI (event `review_closed`, actor `user`).

While a review is `closed`, `create_thread`, `reply`, `edit_comment`, `set_status`, and `post_note` are rejected (§6) — the caller must `reopen_review` first. `submit_revision` remains the sole exception: submitting new work is itself an unambiguous signal to reopen, so it does so implicitly (§3, `submit_revision`).

### `reopen_review`

Explicitly reopen a closed review without submitting a new revision.

```jsonc
// params
{ "review": "rv-a3f8" }
```

---

## 4. Event payloads

Payloads carry enough context that Claude can usually act **without** a follow-up `get_review`:

| Type | Payload |
|---|---|
| `thread_created` | The full Thread object. |
| `comment_added` | `{ "thread": <full Thread including all comments>, "comment": <the new Comment> }` — full thread included because replying well requires the conversation, and threads are short. |
| `comment_edited` | `{ "thread": <full Thread, post-truncation>, "comment": <the edited Comment>, "truncated": [<comment ids removed>] }` |
| `thread_status_changed` | `{ "thread": "t-4", "status": "wontfix", "path": "…", "title": "…" }` |
| `note_added` | The Note. User-authored notes are directives — Claude should treat them as steering input. |
| `revision_submitted` | `{ "revision": 2 }` (Claude-actor only; excluded from the user-filtered stream). |
| `user_done` | `{}` — the user clicked "Done for now". Signals Claude to exit the wait loop and wrap up (address anything outstanding, then `close_review` or summarize in chat). |
| `review_closed` | `{ "summary": "…?" }` |
| `review_reopened` | `{}` — emitted both by explicit `reopen_review` and by `submit_revision`'s implicit reopen (alongside `revision_submitted`). |

---

## 5. Web UI contract

What it must let the user **do** (design freedom on everything else):

- **Diff viewing** — per-file side-by-side (unified as a toggle), file tree with per-file open-thread counts, revision switcher, old↔new revision comparison for a file. Threads render inline at their anchor; `outdated` threads group separately, shown against their original revision's context.
- **View lenses** — narrow the displayed diff to a commit sub-range within the revision (e.g. just the latest commit, or commit-by-commit), computed on demand via git; no new revision and no Claude involvement. Because anchors live in revision content, not in a diff rendering (§2), threads survive lens changes. Thread creation inside a lens is allowed when the target line's content exists identically at the revision head (or base, for OLD-side) — the same matcher re-anchoring uses; otherwise the UI explains the line was superseded and offers the full view. Lenses are unavailable when the sub-range isn't expressible in git history (e.g. a squashed range); degrade to the full view.
- **Thread actions** — create a thread on any line/range of either side (not on `binary`-status files); reply; edit or retract your own comment (truncates later replies in the thread, mirroring `edit_comment`, §3); resolve / reopen / mark wontfix; filter by status and severity. A `suggestion` on a thread renders as a proposed-change block.
- **Review-level actions** — write a note (directive to Claude); **"Done for now"** button emitting `user_done`; close review.
- **Liveness** — the UI updates live (SSE or websocket) as Claude streams threads and notes in; no manual refresh.
- **Presence** — a status line showing the latest `progress` note, plus an indicator derived from server state: "Claude is listening" while a `wait_for_activity` call is open, "Claude is working" otherwise (while the review is open). This is what makes the collaboration feel two-way.
- **Multiple reviews** — a picker across the persisted reviews in `.codevolley/`.

Server: embedded HTTP on localhost, fixed default port (e.g. 4877), configurable. No auth (localhost, single developer).

---

## 6. Errors

Structured, self-correcting error strings (the caller is a model — errors should teach):

- Unknown review/thread id → include the list of valid ids (+titles for reviews).
- `create_thread` on a path not in the latest revision → say so and include the revision's valid paths.
- `create_thread` on a `binary`-status file → say so; binary files have no line content to anchor to.
- Line out of range → include the file's line count on that side.
- Invalid committish in `create_review`/`submit_revision` → surface git's stderr.
- `wait_for_activity` with `after` > `lastSeq` → error (cursor from the future indicates a bug), include current `lastSeq`.
- `create_thread`, `reply`, `edit_comment`, `set_status`, or `post_note` on a `closed` review → error naming the review and pointing at `reopen_review`.
- `edit_comment` on a comment not authored by the caller → error naming the actual author.
- Any tool call when the UI daemon isn't reachable → error naming the start command (`codevolley serve`); Claude should tell the user and retry the call once it's running — no session restart needed.

---

## 7. The workflow this contract serves

For the implementer's intuition — the companion skill drives this sequence:

1. **Open.** (Assumes the user has already started the UI daemon — `codevolley serve` — for this repo; if not, `create_review` fails with the daemon-not-running error and Claude asks them to start it.) Claude computes the merge-base, calls `create_review` (excluding frontend paths), hands the user the URL, posts a `progress` note with the review plan.
2. **Stream.** Claude reviews file-by-file (existing two-pass methodology). Each verified finding becomes `create_thread` immediately — the user reads and replies while Claude is still reviewing.
3. **Converse.** Claude interleaves reviewing with draining `wait_for_activity`; after the final pass it parks in the wait loop. User replies get thread replies; user threads get investigated and answered; user notes steer the remaining review.
4. **Fix.** The user replies "fix it" on a thread → Claude edits the code → `submit_revision` → the result's `outdated` list tells Claude which threads to re-verify → verified fixes get `reply` + `resolved`. This loop — fix, resubmit, re-anchor, resolve — is the core payoff of the revision model.
5. **Close.** On `user_done` (or the user saying so in chat): resolve loose ends, `close_review` with a summary. State persists in `.codevolley/`; a later session resumes via `get_review`.

## 8. Explicitly out of scope (v1)

- Threads on files outside the diff (whole-repo commentary).
- Multi-user / remote access, auth.
- Git write operations (the server only reads; Claude edits code through its own tools).
- Applying `suggestion` blocks from the UI (render-only in v1).
- Cross-review linking, dashboards, metrics.
- Re-anchoring across a changed `base` between revisions (e.g. after a rebase). The matcher in §3 assumes revision N+1's content shares lineage with revision N's; if `base` moves, `OLD`-side anchors especially may go `outdated` more than necessary, or in rare cases match content that only coincidentally looks the same. No special handling in v1 — a documented limitation, not a solved problem.
