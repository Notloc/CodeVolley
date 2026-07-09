import { useState } from "react";
import * as api from "../api.js";
import { ThreadRefText } from "./Markdown.js";
import type { Note, ReviewStatus } from "../types.js";

export function ReviewActions({
  reviewId,
  status,
  notes,
  listening,
  onChanged,
}: {
  reviewId: string;
  status: ReviewStatus;
  notes: Note[];
  listening: boolean | null;
  onChanged: () => void;
}) {
  const [noteBody, setNoteBody] = useState("");
  const [summary, setSummary] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [busy, setBusy] = useState(false);

  const latestProgress = [...notes].reverse().find((n) => n.kind === "progress");

  return (
    <div className="review-actions">
      <div className="presence-line">
        {latestProgress && (
          <span className="progress-text">
            <ThreadRefText>{latestProgress.body}</ThreadRefText>
          </span>
        )}
        {status === "open" && listening !== null && (
          <span className={`presence-indicator ${listening ? "listening" : "working"}`}>
            {listening ? "Claude is listening" : "Claude is working"}
          </span>
        )}
      </div>

      {status === "open" && (
        <>
          <div className="note-composer">
            <textarea placeholder="Note to Claude (steering directive)…" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} />
            <div className="composer-actions">
              <button
                disabled={busy || noteBody.trim().length === 0}
                onClick={async () => {
                  setBusy(true);
                  await api.postNote(reviewId, "note", noteBody.trim());
                  setBusy(false);
                  setNoteBody("");
                  onChanged();
                }}
              >
                Post note
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await api.markDone(reviewId);
                  setBusy(false);
                  onChanged();
                }}
              >
                Done for now
              </button>
              <button disabled={busy} onClick={() => setShowClose((s) => !s)}>
                Close review
              </button>
            </div>
          </div>

          {showClose && (
            <div className="close-composer">
              <textarea placeholder="Closing summary…" value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
              <div className="composer-actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await api.closeReview(reviewId, summary.trim());
                    setBusy(false);
                    setShowClose(false);
                    onChanged();
                  }}
                >
                  Confirm close
                </button>
                <button onClick={() => setShowClose(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
