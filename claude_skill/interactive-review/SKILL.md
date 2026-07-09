---
name: interactive-review
description: Run a live, collaborative code review with the developer through the CodeVolley MCP server — findings become line-anchored comment threads in a browser UI, streamed in as they're verified, with back-and-forth replies, fix-and-resubmit cycles, and thread resolution. Use when the user says "review this with me", "interactive review", "let's review together", "start a review session", "open a review", or runs /interactive-review. Takes an optional argument — a branch name to diff against (e.g., "release", "hotfix") or "diff" for uncommitted changes only. For a one-shot written review report instead, use code-review-java.
---

# Interactive Code Review

A collaborative review session: findings are delivered as line-anchored threads in the Review server's web UI instead of a report. The developer reads, replies, resolves, and opens threads of their own while you work; you pick up their activity through `wait_for_activity` and respond in place.

**Prerequisite**: the CodeVolley MCP server tools (`mcp__codevolley__*`). If they aren't available, stop and tell the user the CodeVolley server isn't connected — don't fall back to a report-style review unless they ask.

Three tools exist beyond the core contract: `reopen_review` (resume a closed review explicitly), `focus_thread` (mark the thread you're actively working — see §4), and `edit_comment` — use the latter sparingly: editing one of your comments **truncates every later comment in the thread**, including the user's replies. Prefer a fresh `reply` to correct yourself; only edit when nothing follows the comment.

**Methodology source**: Read [references/review-methodology.md](references/review-methodology.md) before starting. It defines *what to look for* — Pass 1 (technical rules) and Pass 2 (semantics subagent). This SKILL.md defines how findings are delivered and what happens after.

## 1. Open the review

Parse the argument to determine the diff:

- **Branch name** (e.g., `hotfix`, `release`, `master`): review the branch's changes — `base` is `$(git merge-base <branch> HEAD)`.
- **`diff`** or no argument: review uncommitted changes (staged + unstaged) — `base` is `HEAD`.

Then:

```
create_review({
  title: "<work under review>",   // e.g. "ticket-27556"
  base:  <merge-base SHA for branch reviews, or HEAD for uncommitted-only>,
  head:  "WORKTREE"
})
```

**Title = the work being reviewed, never the base.** The skill argument names what you're diffing *against* — it must not become the title. Name the review after the current branch (`git branch --show-current`, typically `ticket-NNNNN`); if the current branch is a long-lived branch rather than a ticket branch, use a short description of the change instead.

Capture the **full diff** — no pathspec filtering. The revision defines what the user can see and where threads can anchor, so excluding a path would make it invisible and un-commentable in the UI. Review *depth* is decided per file type by the methodology, not by exclusion.

Give the user the review URL immediately — they read along while you review. Post a `progress` note sketching your plan (file groups, expected passes). Record `lastSeq` from the result; it's your event cursor for the whole session.

## 2. Stream the technical pass

Work file-by-file per the methodology's Pass 1 rules. The delivery rules:

- **Verify before posting.** A thread is a claim the user will act on. Do the grep/context-reading first; never post a hunch and verify later. If you must raise something unverified, make it severity `question`.
- **One finding, one thread.** Post with `create_thread` the moment a finding is verified — don't batch per file. `title` is a short imperative summary; `body` explains what's wrong, *why it matters here*, and the concrete fix. Use the `suggestion` field only when the replacement for the anchored range is small and you're certain of it.
- **Cross-reference threads by id.** A `t-x` mention in any comment or note body renders as a clickable link to that thread in the UI — so when findings relate (same root cause, one fix covering several, "folded into t-x"), reference them by id freely rather than describing them.
- **Severity mapping**: should-fix-before-merge → `issue`; non-blocking improvement or drive-by refactoring idea → `suggestion`; you need information to judge → `question`; trivia → `nit`; genuinely good work → `praise` (use it — this is a collaboration, not an audit).
- **Anchor precisely.** Anchor to the offending line(s) on the `NEW` side (use `OLD` only for deleted code). Ranges (`end_line`) for multi-line findings. Line numbers go stale fast in a live session — always verify against the *current* file (grep for the target content) immediately before posting, especially for findings computed from diff hunks or returned by the semantics subagent, whose numbers date from when it read the files.
- **Drain between files.** After each file, call `wait_for_activity({ after: <cursor>, timeout_seconds: 0 })` — an instant poll. Handle anything pending (see §4) before moving on; early replies often redirect the rest of the review. A user `note` is a steering directive — obey it (e.g. "skip style nits" means stop posting nits).
- Post a short `progress` note when you move between file groups so the UI status line tracks you.

## 3. Semantics pass

Spawn the Pass 2 subagent exactly as the methodology file specifies. The subagent **returns findings to you**; you verify and post them as threads yourself (mapping SHOULD FIX → `issue`, CONSIDER → `suggestion`). Don't give the subagent MCP access — posting stays in one place so you can dedupe against threads you already opened.

**Pre-existing issues** spotted while reading context: in a changed file, post as a clearly-labeled `suggestion` thread on the offending line; in a file outside the revision (threads can't anchor there), mention it in a review-level `note` instead.

When both passes are done, post a `summary` note: finding counts by severity and a one-paragraph overall assessment (a clean review is a valid result — say so rather than manufacturing threads).

## 4. The conversation loop

Now park in the loop:

```
wait_for_activity({ after: <cursor>, timeout_seconds: 90 })
```

Advance the cursor to `lastSeq` after every call.

**Every user touch on a thread sets its `awaitingClaude` flag; your job is to drain it.** Replying auto-clears it. For user messages that warrant no reply — praise, "thanks", simple acknowledgements — call `acknowledge_thread` instead of posting a filler comment. Don't leave a thread awaiting: the flag drives a "Claude is replying…" spinner in the UI, so an unhandled thread looks perpetually pending to the user. (Resolving/wontfixing also clears it.)

**Signal which thread you're on.** The moment you pick a thread to work — right after `wait_for_activity` returns, or as you take each item off the awaiting queue when resuming (§5) — call `focus_thread({ review, thread })` *before* investigating or editing. It highlights that thread in the UI as the one you're actively working, so the user can tell it apart from the rest of the queue. No clearing call afterwards — replying, resolving, or acknowledging clears it. The server allows only **one** active thread at a time (no subagent support yet): focusing a new thread silently unfocuses the previous one, so focusing several up front leaves only the last highlighted. Work serially — focus, handle, then focus the next.

Handle each user event:

- **`comment_added`** — the payload includes the full thread; respond in context with `reply`. If they've pointed out you're wrong, verify, concede plainly, and resolve. If you still believe the finding, defend it **once** with concrete evidence, then defer — "wontfix by the developer" is a legitimate outcome, not a failure. Don't loop arguing.
- **`thread_created`** (user-opened) — this is the user raising a concern to *you*. Investigate properly (read the code, grep) before replying; answer `question`s directly; if their concern reveals a real problem, say so and treat it as a finding.
- **`thread_status_changed`** — usually needs no response. If they resolve something you consider a genuine `issue`, one polite reply stating the risk is fine; then let it go.
- **`note_added`** — steering input; adjust and acknowledge with a `progress` note.
- **`comment_edited`** — the user revised a comment; the payload carries the full thread, so treat its latest state as truth. Usually needs no reply of its own unless the edit changes what they're asking.
- **Rapid status flapping** (resolve→reopen→wontfix in seconds) is usually the user clicking around, not a signal — act on the final state only.
- **`user_done`** — exit the loop and wrap up (§6).

**Fix requests.** The UI has a **"Fix It!" button** that posts this canned reply: *"Fix it — take the obvious action to resolve this thread: make the change, then reply here with what you did."* Treat it like any freehand "fix it" / "go ahead": make the edit. But the button promises an *obvious* action — if there isn't one (several defensible approaches, a tradeoff the user should weigh, or the fix would ripple beyond the thread's scope), don't guess: reply with the options and your recommendation, keep the thread open, and wait for their pick. A wrong guess costs a fix-resubmit-revert cycle; a one-reply question costs seconds.

When fixes are clear, batch — if several threads have pending fixes, fix them all before resubmitting. Fix It! presses tend to arrive in bursts as the user works down the thread list, so after finishing a fix, drain once more (`timeout_seconds: 0`) *before* submitting the revision — a just-arrived press can ride the same revision instead of costing another cycle. Then `submit_revision({ message: "Fixes from threads …" })`. The result's `outdated` list is your work queue: re-read each outdated thread's location in the new revision, confirm the fix actually addresses it, and `reply` with what you changed + `status: "resolved"`. A thread that comes back `reanchored` (not outdated) after a fix pass means your edit *didn't touch it* — recheck before resolving.

**Idle handling.** `timedOut: true` with no events is the idle state — just call `wait_for_activity` again. After **3 consecutive empty timeouts** (~5 minutes of silence), post a `progress` note ("Standing by — nudge me in chat when you're back"), tell the user the same in chat, and end your turn. Don't burn the session polling an empty room.

## 5. Resuming

In a fresh session (or after idle-stop), `get_review` reconstructs everything: threads, conversation history, current revision, and `lastSeq` to resume the wait loop. The threads with **`awaitingClaude: true` are your outstanding work queue** — user input that was never handled. Work through each (reply or acknowledge) *before* parking in the wait loop; the event stream is only the live delta and won't replay what you missed. Never re-review from scratch when a review for this work already exists — pick up the awaiting threads.

## 6. Wrapping up

On `user_done` (or the user saying so in chat): resolve or explicitly hand off any outstanding open threads (a reply noting what's still unaddressed), make sure no thread is left with `awaitingClaude: true`, then `close_review` with a summary — finding counts by severity and status (resolved / wontfix / open), what was fixed across revisions, and a brief overall assessment. Mirror the closing summary in chat so the session record is complete.
