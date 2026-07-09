import { useState } from "react";
import * as api from "../api.js";
import { isResolvable } from "../threads.js";
import type { Thread, ThreadStatus } from "../types.js";
import { Markdown } from "./Markdown.js";

const STATUS_TRANSITIONS: { status: ThreadStatus; label: string }[] = [
  { status: "resolved", label: "Resolve" },
  { status: "wontfix", label: "Won't fix" },
  { status: "open", label: "Reopen" },
];

// Posted as a reply when the user hits "Fix it!" — a directive Claude picks up
// through wait_for_activity like any other comment.
const FIX_IT_DIRECTIVE =
  "**Fix it** — take the obvious action to resolve this thread: make the change, then reply here with what you did.";

export function ThreadPanel({
  reviewId,
  thread,
  claudeWorking,
  onChanged,
  bare = false,
}: {
  reviewId: string;
  thread: Thread;
  claudeWorking: boolean;
  onChanged: () => void;
  // Bare mode drops the panel's own header and collapse behaviour — for hosts
  // (like Overview cards) that show the title/status/collapse themselves.
  bare?: boolean;
}) {
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  // `null` = follow status (resolved/wontfix collapse, open expands), so
  // resolving a thread auto-collapses it until the user overrides by clicking.
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = bare || (override ?? thread.status === "open");

  // Plain comments (praise) keep a minimal lifecycle purely so they can be
  // tucked away: "Nice" resolves (collapses) the comment, Reopen undoes it —
  // no won't-fix, no status pill. Otherwise: from open you can resolve or
  // mark won't-fix; from a closed state (resolved or wontfix) the only move
  // is reopen — no jumping resolved <-> wontfix.
  const resolvable = isResolvable(thread);
  const availableTransitions = !resolvable
    ? thread.status === "open"
      ? [{ status: "resolved" as ThreadStatus, label: "Nice" }]
      : [{ status: "open" as ThreadStatus, label: "Reopen" }]
    : thread.status === "open"
      ? STATUS_TRANSITIONS.filter((t) => t.status !== "open")
      : STATUS_TRANSITIONS.filter((t) => t.status === "open");

  // Two indicator levels while a Claude session is actively working:
  // "thinking" — Claude has declared this thread his current focus (via the
  // focus_thread tool); "waiting" — the thread has unhandled user input but
  // Claude hasn't turned to it yet. Both server-tracked; both meaningless
  // without a live session, hence the claudeWorking gate.
  const showThinking = claudeWorking && thread.claudeThinking;
  const showWaiting = claudeWorking && thread.awaitingClaude && !showThinking;

  return (
    <div className={`thread-panel severity-${thread.severity} status-${thread.status} ${expanded ? "" : "collapsed"}`}>
      {!bare && (
        <div className="thread-header" onClick={() => setOverride(!expanded)}>
          <span className="collapse-caret">{expanded ? "▾" : "▸"}</span>
          {resolvable && <span className="thread-status-tag">{thread.status}</span>}
          <strong>{thread.title}</strong>
          <span className="severity-tag">{thread.severity}</span>
          {thread.anchorState === "outdated" && <span className="outdated-tag">outdated</span>}
        </div>
      )}

      {expanded && (
        <>
          {thread.comments.map((c) => (
        <div key={c.id} className={`comment author-${c.author}`}>
          <div className="comment-meta">
            <span className="comment-author">{c.author}</span>
            {c.author === "user" && editingId !== c.id && (
              <button className="link-button" onClick={() => { setEditingId(c.id); setEditBody(c.body); }}>
                edit
              </button>
            )}
          </div>
          {editingId === c.id ? (
            <div className="comment-edit">
              <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={2} />
              <div className="composer-actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await api.editComment(reviewId, thread.id, c.id, editBody);
                    setBusy(false);
                    setEditingId(null);
                    onChanged();
                  }}
                >
                  Save
                </button>
                <button onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="comment-body"><Markdown>{c.body}</Markdown></div>
          )}
        </div>
      ))}

      {showThinking && (
        <div className="comment replying">
          <span className="spinner" />
          <span>Claude is thinking…</span>
        </div>
      )}
      {showWaiting && (
        <div className="comment waiting">
          <span className="wait-dot" />
          <span>Waiting for Claude…</span>
        </div>
      )}

      {thread.suggestion && (
        <div className="suggestion-block">
          <div className="suggestion-label">Suggested change</div>
          <pre>{thread.suggestion}</pre>
        </div>
      )}

      <div className="thread-reply">
        <textarea placeholder="Reply…" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={2} />
        <div className="composer-actions thread-reply-actions">
          <button
            className="reply-button"
            disabled={busy || replyBody.trim().length === 0}
            onClick={async () => {
              setBusy(true);
              await api.reply(reviewId, thread.id, replyBody.trim());
              setBusy(false);
              setReplyBody("");
              onChanged();
            }}
          >
            Reply
          </button>
          {resolvable && (
            <button
              className="fix-it-button"
              disabled={busy}
              title="Ask Claude to take the obvious action and resolve this thread"
              onClick={async () => {
                setBusy(true);
                await api.reply(reviewId, thread.id, FIX_IT_DIRECTIVE);
                setBusy(false);
                onChanged();
              }}
            >
              Fix it!
            </button>
          )}
          {availableTransitions.length > 0 && (
            <div className="reply-transitions">
              {availableTransitions.map((t) => (
                <button
                  key={t.status}
                  className={t.label === "Nice" ? "nice-button" : undefined}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await api.setStatus(reviewId, thread.id, t.status);
                    setBusy(false);
                    onChanged();
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
