import { useState } from "react";
import * as api from "../api.js";
import type { Thread, ThreadStatus } from "../types.js";

const STATUS_TRANSITIONS: { status: ThreadStatus; label: string }[] = [
  { status: "resolved", label: "Resolve" },
  { status: "wontfix", label: "Won't fix" },
  { status: "open", label: "Reopen" },
];

export function ThreadPanel({ reviewId, thread, onChanged }: { reviewId: string; thread: Thread; onChanged: () => void }) {
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);

  const availableTransitions = STATUS_TRANSITIONS.filter((t) => t.status !== thread.status);

  return (
    <div className={`thread-panel severity-${thread.severity} status-${thread.status}`}>
      <div className="thread-header">
        <span className="severity-tag">{thread.severity}</span>
        <strong>{thread.title}</strong>
        <span className="thread-status-tag">{thread.status}</span>
        {thread.anchorState === "outdated" && <span className="outdated-tag">outdated</span>}
      </div>

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
            <div className="comment-body">{c.body}</div>
          )}
        </div>
      ))}

      {thread.suggestion && (
        <div className="suggestion-block">
          <div className="suggestion-label">Suggested change</div>
          <pre>{thread.suggestion}</pre>
        </div>
      )}

      <div className="thread-reply">
        <textarea placeholder="Reply…" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} rows={2} />
        <div className="composer-actions">
          <button
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
          {availableTransitions.map((t) => (
            <button
              key={t.status}
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
      </div>
    </div>
  );
}
