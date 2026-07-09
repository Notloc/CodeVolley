import { generateReviewId } from "../shared/id.js";
import {
  type AcknowledgeThreadRequest,
  type AcknowledgeThreadResponse,
  type FocusThreadRequest,
  type FocusThreadResponse,
  type CloseReviewRequest,
  type CloseReviewResponse,
  type CreateReviewRequest,
  type CreateReviewResponse,
  type CreateThreadRequest,
  type CreateThreadResponse,
  type EditCommentRequest,
  type EditCommentResponse,
  type GetFileContentRequest,
  type GetFileContentResponse,
  type GetReviewRequest,
  type ListReviewsResponse,
  type PostNoteRequest,
  type PostNoteResponse,
  type ReopenReviewRequest,
  type ReopenReviewResponse,
  type ReplyRequest,
  type ReplyResponse,
  type SetStatusRequest,
  type SetStatusResponse,
  type SubmitRevisionRequest,
  type SubmitRevisionResponse,
  WAIT_FOR_ACTIVITY_DEFAULT_TIMEOUT_SECONDS,
  WAIT_FOR_ACTIVITY_MAX_TIMEOUT_SECONDS,
  type WaitForActivityRequest,
  type WaitForActivityResponse,
} from "../shared/internal-api.js";
import {
  type Actor,
  type Anchor,
  type Comment,
  type Event,
  type Note,
  RevisionFileSchema,
  type Review,
  ThreadSchema,
} from "../shared/types.js";
import { appendEvent } from "./events.js";
import { NotFoundError, ReviewClosedError, ValidationError } from "./errors.js";
import { captureDiff, GitError } from "./git.js";
import { nextCommentId, nextNoteId, nextThreadId } from "./ids.js";
import { readIndex, readReview, resolveReviewId, writeReview } from "./persistence.js";
import { findAnchorLine } from "./reanchor.js";
import { projectReview, type StoredReview, type StoredRevision, type StoredThread } from "./storage-types.js";
import { isListening, isOnline, setListening, waitForReviewActivity } from "./waiters.js";

export { GitError };

export async function resolveAndReadReview(repoRoot: string, idOrTitle: string): Promise<StoredReview> {
  const id = await resolveReviewId(repoRoot, idOrTitle);
  if (!id) {
    const index = await readIndex(repoRoot);
    const known = index.map((e) => `${e.id} ("${e.title}")`).join(", ") || "(none)";
    throw new NotFoundError(`Unknown review "${idOrTitle}". Known reviews: ${known}`);
  }
  const stored = await readReview(repoRoot, id);
  if (!stored) {
    throw new NotFoundError(`Review "${id}" is indexed but its file is missing from .codevolley/reviews/.`);
  }
  return stored;
}

function assertWritable(review: StoredReview): void {
  if (review.status === "closed") {
    throw new ReviewClosedError(review.id);
  }
}

function findThreadOrThrow(review: StoredReview, threadId: string): StoredThread {
  const thread = review.threads.find((t) => t.id === threadId);
  if (!thread) {
    const known = review.threads.map((t) => t.id).join(", ") || "(none)";
    throw new NotFoundError(`Unknown thread "${threadId}" in review "${review.id}". Known threads: ${known}`);
  }
  return thread;
}

export async function createReview(
  repoRoot: string,
  req: CreateReviewRequest,
  port: number,
): Promise<CreateReviewResponse> {
  const capture = await captureDiff(repoRoot, req.base, req.head, req.paths ?? []);

  let id: string;
  for (;;) {
    id = generateReviewId();
    if (!(await readReview(repoRoot, id))) break;
  }

  const now = new Date().toISOString();
  const url = `http://localhost:${port}/review/${id}`;

  const revision: StoredRevision = {
    number: 1,
    message: null,
    base: capture.resolvedBase,
    head: capture.resolvedHead,
    paths: req.paths ?? [],
    capturedAt: now,
    files: capture.files,
  };

  const review: StoredReview = {
    id,
    title: req.title,
    status: "open",
    createdAt: now,
    url,
    revisions: [revision],
    threads: [],
    notes: [],
    events: [],
    lastSeq: 0,
    _threadSeq: 0,
    _noteSeq: 0,
  };

  await writeReview(repoRoot, review);

  return {
    id,
    url,
    revision: 1,
    files: RevisionFileSchema.array().parse(revision.files),
    lastSeq: 0,
  };
}

export type GetReviewResult = { ok: true; review: Review } | { ok: false; error: string };

// The multi-review picker (design doc §5): every review persisted under
// .codevolley/, newest first.
export async function listReviews(repoRoot: string): Promise<ListReviewsResponse> {
  const index = await readIndex(repoRoot);
  return [...index].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReview(repoRoot: string, req: GetReviewRequest): Promise<GetReviewResult> {
  const id = await resolveReviewId(repoRoot, req.review);
  if (!id) {
    const index = await readIndex(repoRoot);
    const known = index.map((e) => `${e.id} ("${e.title}")`).join(", ") || "(none)";
    return { ok: false, error: `Unknown review "${req.review}". Known reviews: ${known}` };
  }

  const stored = await readReview(repoRoot, id);
  if (!stored) {
    return { ok: false, error: `Review "${id}" is indexed but its file is missing from .codevolley/reviews/.` };
  }

  const wantsFilter = req.status !== undefined || (req.path !== undefined && req.path !== null);
  const filtered: StoredReview = wantsFilter
    ? {
        ...stored,
        threads: stored.threads.filter(
          (t) =>
            (req.status === undefined || req.status.includes(t.status)) &&
            (req.path === undefined || req.path === null || t.anchor.path === req.path || t.currentAnchor.path === req.path),
        ),
      }
    : stored;

  return { ok: true, review: projectReview(filtered) };
}

// Anchors against the latest revision (design doc §3: create_thread).
export async function createThread(
  repoRoot: string,
  req: CreateThreadRequest,
  actor: Actor,
): Promise<CreateThreadResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);

  const latestRevision = review.revisions[review.revisions.length - 1];
  const file = latestRevision.files.find((f) => f.path === req.path);
  if (!file) {
    const known = latestRevision.files.map((f) => f.path).join(", ") || "(none)";
    throw new ValidationError(`Path "${req.path}" is not in revision ${latestRevision.number}. Valid paths: ${known}`);
  }
  if (file.status === "binary") {
    throw new ValidationError(`"${req.path}" is a binary file — it has no line content to anchor a thread to.`);
  }

  const side = req.side ?? "NEW";
  const content = side === "NEW" ? file.newContent : file.oldContent;
  if (content === null) {
    throw new ValidationError(`"${req.path}" has no ${side} content in revision ${latestRevision.number} (file is ${file.status}).`);
  }
  const lineCount = content.split("\n").length;
  if (req.line < 1 || req.line > lineCount) {
    throw new ValidationError(`Line ${req.line} is out of range for "${req.path}" (${side} side has ${lineCount} lines).`);
  }
  if (req.end_line != null && (req.end_line < req.line || req.end_line > lineCount)) {
    throw new ValidationError(`end_line ${req.end_line} is out of range for "${req.path}" (${side} side has ${lineCount} lines).`);
  }

  const anchor: Anchor = {
    revision: latestRevision.number,
    path: req.path,
    side,
    line: req.line,
    endLine: req.end_line ?? null,
  };

  const thread: StoredThread = {
    id: nextThreadId(review),
    severity: req.severity,
    status: "open",
    title: req.title,
    anchor,
    currentAnchor: anchor,
    anchorState: "current",
    suggestion: req.suggestion ?? null,
    comments: [],
    // A user-authored thread needs Claude's attention; a Claude review comment
    // is awaiting the user, not Claude.
    awaitingClaude: actor === "user",
    claudeThinking: false,
    _commentSeq: 0,
  };
  const comment: Comment = { id: nextCommentId(thread), author: actor, body: req.body, createdAt: new Date().toISOString() };
  thread.comments.push(comment);
  review.threads.push(thread);

  appendEvent(review, actor, "thread_created", ThreadSchema.parse(thread));
  await writeReview(repoRoot, review);

  return { thread: thread.id };
}

export async function reply(repoRoot: string, req: ReplyRequest, actor: Actor): Promise<ReplyResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);
  const thread = findThreadOrThrow(review, req.thread);

  const comment: Comment = { id: nextCommentId(thread), author: actor, body: req.body, createdAt: new Date().toISOString() };
  thread.comments.push(comment);
  // A user reply reopens the need for Claude's attention; a Claude reply clears
  // it (it's now the user's turn).
  thread.awaitingClaude = actor === "user";
  // A Claude reply is the natural end of "thinking" on the thread.
  if (actor === "claude") thread.claudeThinking = false;
  appendEvent(review, actor, "comment_added", { thread: ThreadSchema.parse(thread), comment });

  if (req.status !== undefined && req.status !== thread.status) {
    thread.status = req.status;
    if (thread.status !== "open") thread.awaitingClaude = false;
    appendEvent(review, actor, "thread_status_changed", {
      thread: thread.id,
      status: thread.status,
      path: thread.anchor.path,
      title: thread.title,
    });
  }

  await writeReview(repoRoot, review);
  return { thread: thread.id, status: thread.status };
}

// Truncates the thread: every comment after the edited one is discarded
// (design doc §3: edit_comment). Only the comment's own author may edit it.
export async function editComment(repoRoot: string, req: EditCommentRequest, actor: Actor): Promise<EditCommentResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);
  const thread = findThreadOrThrow(review, req.thread);

  const idx = thread.comments.findIndex((c) => c.id === req.comment);
  if (idx === -1) {
    const known = thread.comments.map((c) => c.id).join(", ") || "(none)";
    throw new NotFoundError(`Unknown comment "${req.comment}" in thread "${thread.id}". Known comments: ${known}`);
  }
  const target = thread.comments[idx];
  if (target.author !== actor) {
    throw new ValidationError(`Comment "${req.comment}" was authored by "${target.author}", not "${actor}" — edit_comment can only edit the caller's own comments.`);
  }

  const truncated = thread.comments.slice(idx + 1).map((c) => c.id);
  target.body = req.body;
  thread.comments = thread.comments.slice(0, idx + 1);

  appendEvent(review, actor, "comment_edited", { thread: ThreadSchema.parse(thread), comment: target, truncated });
  await writeReview(repoRoot, review);

  return { thread: thread.id, comments: thread.comments };
}

export async function setStatus(repoRoot: string, req: SetStatusRequest, actor: Actor): Promise<SetStatusResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);
  const thread = findThreadOrThrow(review, req.thread);

  thread.status = req.status;
  // A resolved/wontfix thread no longer awaits Claude; a user reopening one is
  // asking for Claude again.
  thread.awaitingClaude = thread.status === "open" && actor === "user";
  // Claude acting on the status ends his thinking; so does the thread closing
  // out from under him.
  if (actor === "claude" || thread.status !== "open") thread.claudeThinking = false;
  appendEvent(review, actor, "thread_status_changed", {
    thread: thread.id,
    status: thread.status,
    path: thread.anchor.path,
    title: thread.title,
  });

  await writeReview(repoRoot, review);
  return { thread: thread.id, status: thread.status };
}

// Clears the "awaiting Claude" flag without adding a comment — for when the
// user's message warrants no reply (design: Claude can dismiss it). No-op on
// status, so the thread stays open/resolved as-is.
export async function acknowledgeThread(
  repoRoot: string,
  req: AcknowledgeThreadRequest,
  actor: Actor,
): Promise<AcknowledgeThreadResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);
  const thread = findThreadOrThrow(review, req.thread);

  thread.awaitingClaude = false;
  thread.claudeThinking = false;
  appendEvent(review, actor, "thread_attention_cleared", {
    thread: thread.id,
    path: thread.anchor.path,
    title: thread.title,
  });

  await writeReview(repoRoot, review);
  return { thread: thread.id, awaitingClaude: thread.awaitingClaude };
}

// One thread at a time: focusing a thread steals focus from every other.
// Flip to false if parallel sessions/subagents ever work threads
// concurrently — everything downstream already handles multiple flags.
const SINGLE_FOCUS = true;

// Claude declares the thread he's turning his attention to (design: the UI's
// "Claude is thinking…" indicator). The flag ends when he replies, closes,
// or acknowledges the thread — or focuses the next one.
export async function focusThread(repoRoot: string, req: FocusThreadRequest, actor: Actor): Promise<FocusThreadResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);
  const thread = findThreadOrThrow(review, req.thread);

  const unfocused: string[] = [];
  if (SINGLE_FOCUS) {
    for (const other of review.threads) {
      if (other.id !== thread.id && other.claudeThinking) {
        other.claudeThinking = false;
        unfocused.push(other.id);
      }
    }
  }
  thread.claudeThinking = true;
  appendEvent(review, actor, "thread_focused", {
    thread: thread.id,
    path: thread.anchor.path,
    title: thread.title,
    unfocused,
  });

  await writeReview(repoRoot, review);
  return { thread: thread.id, claudeThinking: true, unfocused };
}

export async function postNote(repoRoot: string, req: PostNoteRequest, actor: Actor): Promise<PostNoteResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  assertWritable(review);

  const note: Note = { id: nextNoteId(review), author: actor, kind: req.kind, body: req.body, createdAt: new Date().toISOString() };
  review.notes.push(note);
  appendEvent(review, actor, "note_added", note);

  await writeReview(repoRoot, review);
  return { note: note.id };
}

// Posts the summary as a `summary` note, sets status closed (design doc §3:
// close_review). No writable guard — closing an already-closed review is a
// harmless no-op re-close, not an error.
export async function closeReview(repoRoot: string, req: CloseReviewRequest, actor: Actor): Promise<CloseReviewResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);

  const note: Note = { id: nextNoteId(review), author: actor, kind: "summary", body: req.summary, createdAt: new Date().toISOString() };
  review.notes.push(note);
  review.status = "closed";

  appendEvent(review, actor, "review_closed", { summary: req.summary });
  await writeReview(repoRoot, review);

  return { review: review.id, status: "closed" };
}

export async function reopenReview(repoRoot: string, req: ReopenReviewRequest, actor: Actor): Promise<ReopenReviewResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);

  review.status = "open";
  appendEvent(review, actor, "review_reopened", {});
  await writeReview(repoRoot, review);

  return { review: review.id, status: "open" };
}

// Long-polls the event log for actor:user events past `after` (design doc
// §3: wait_for_activity). Re-reads from disk each wake because writeReview
// is the sole writer and its atomic rename means every read sees a fully
// consistent snapshot — never a torn write.
export async function waitForActivity(repoRoot: string, req: WaitForActivityRequest): Promise<WaitForActivityResponse> {
  const timeoutSeconds = Math.min(req.timeout_seconds ?? WAIT_FOR_ACTIVITY_DEFAULT_TIMEOUT_SECONDS, WAIT_FOR_ACTIVITY_MAX_TIMEOUT_SECONDS);
  const deadline = Date.now() + timeoutSeconds * 1000;

  const initial = await resolveAndReadReview(repoRoot, req.review);
  if (req.after > initial.lastSeq) {
    throw new ValidationError(
      `"after" (${req.after}) is greater than review "${initial.id}"'s current lastSeq (${initial.lastSeq}) — a cursor from the future indicates a bug.`,
    );
  }

  setListening(initial.id, true);
  try {
    let review = initial;
    for (;;) {
      const userEvents = review.events.filter((e) => e.seq > req.after && e.actor === "user");
      if (userEvents.length > 0) {
        return { events: userEvents, lastSeq: review.lastSeq, timedOut: false };
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return { events: [], lastSeq: review.lastSeq, timedOut: true };
      }

      await waitForReviewActivity(review.id, remainingMs);
      review = await resolveAndReadReview(repoRoot, req.review);
    }
  } finally {
    setListening(initial.id, false);
  }
}

// Presence (design doc §5) — whether a wait_for_activity call is currently
// parked on this review. Resolves id-or-title first since `isListening` is
// keyed by canonical review id.
export async function getPresence(repoRoot: string, reviewIdOrTitle: string): Promise<{ listening: boolean; online: boolean }> {
  const review = await resolveAndReadReview(repoRoot, reviewIdOrTitle);
  return { listening: isListening(review.id), online: isOnline() };
}

// The persisted event log, for the web UI's activity timeline. projectReview
// strips events from the review payload (they're storage detail for the
// tools), so the UI fetches them separately.
export async function getReviewEvents(repoRoot: string, reviewIdOrTitle: string): Promise<Event[]> {
  const review = await resolveAndReadReview(repoRoot, reviewIdOrTitle);
  return review.events;
}

// Captures a new immutable revision and re-anchors open threads (design doc
// §3: submit_revision). base/head/paths default to the previous revision's
// values — WORKTREE is always re-captured fresh even when unchanged.
// Submitting to a closed review reopens it implicitly, since submitting new
// work is itself an unambiguous signal to reopen.
export async function submitRevision(repoRoot: string, req: SubmitRevisionRequest, actor: Actor): Promise<SubmitRevisionResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);
  const previous = review.revisions[review.revisions.length - 1];

  const base = req.base ?? previous.base;
  const head = req.head ?? previous.head;
  const paths = req.paths ?? previous.paths;
  const capture = await captureDiff(repoRoot, base, head, paths);

  const newRevision: StoredRevision = {
    number: previous.number + 1,
    message: req.message,
    base: capture.resolvedBase,
    head: capture.resolvedHead,
    paths,
    capturedAt: new Date().toISOString(),
    files: capture.files,
  };
  review.revisions.push(newRevision);

  if (review.status === "closed") {
    review.status = "open";
    appendEvent(review, actor, "review_reopened", {});
  }

  const reanchored: { thread: string; line: number }[] = [];
  const outdated: string[] = [];

  for (const thread of review.threads) {
    if (thread.anchorState === "outdated") continue; // design doc §3: already-outdated threads aren't reprocessed

    const sourceRevision = review.revisions.find((r) => r.number === thread.currentAnchor.revision);
    const newLine = sourceRevision ? findAnchorLine(sourceRevision, newRevision, thread.currentAnchor) : null;

    if (newLine === null) {
      thread.anchorState = "outdated";
      outdated.push(thread.id);
      continue;
    }

    const span = thread.currentAnchor.endLine !== null ? thread.currentAnchor.endLine - thread.currentAnchor.line : null;
    thread.currentAnchor = {
      revision: newRevision.number,
      path: thread.currentAnchor.path,
      side: thread.currentAnchor.side,
      line: newLine,
      endLine: span !== null ? newLine + span : null,
    };
    reanchored.push({ thread: thread.id, line: newLine });
  }

  appendEvent(review, actor, "revision_submitted", { revision: newRevision.number });
  await writeReview(repoRoot, review);

  return {
    revision: newRevision.number,
    files: RevisionFileSchema.array().parse(newRevision.files),
    reanchored,
    outdated,
  };
}

export async function getFileContent(repoRoot: string, req: GetFileContentRequest): Promise<GetFileContentResponse> {
  const review = await resolveAndReadReview(repoRoot, req.review);

  const revision = review.revisions.find((r) => r.number === req.revision);
  if (!revision) {
    const known = review.revisions.map((r) => r.number).join(", ") || "(none)";
    throw new NotFoundError(`Revision ${req.revision} not found in review "${review.id}". Known revisions: ${known}`);
  }

  const file = revision.files.find((f) => f.path === req.path);
  if (!file) {
    const known = revision.files.map((f) => f.path).join(", ") || "(none)";
    throw new NotFoundError(`Path "${req.path}" is not in revision ${req.revision}. Valid paths: ${known}`);
  }

  return {
    path: file.path,
    status: file.status,
    oldPath: file.oldPath,
    oldContent: file.oldContent,
    newContent: file.newContent,
  };
}

// UI-only signal (the "Done for now" button, §5) — no MCP tool exposes
// this; Claude just observes the user_done event via wait_for_activity.
export async function markUserDone(repoRoot: string, reviewIdOrTitle: string): Promise<{ review: string }> {
  const review = await resolveAndReadReview(repoRoot, reviewIdOrTitle);
  appendEvent(review, "user", "user_done", {});
  await writeReview(repoRoot, review);
  return { review: review.id };
}
