import { useCallback, useEffect, useState } from "react";
import * as api from "./api.js";
import { DiffFile } from "./components/DiffFile.js";
import { FileTree } from "./components/FileTree.js";
import { ReviewActions } from "./components/ReviewActions.js";
import type { Review } from "./types.js";

function reviewIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/review\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function ReviewView({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [listening, setListening] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    api.getReview(id).then(setReview).catch((err) => setError(String(err.message ?? err)));
  }, [id]);

  useEffect(refresh, [refresh]);

  // Live updates (§5 "Liveness"): any event on this review means our local
  // snapshot is stale — a full refetch is simple and correct, and get_review
  // is cheap enough that patching state incrementally isn't worth the risk
  // of drifting out of sync with the server's re-anchoring logic.
  useEffect(() => {
    if (!review) return;
    return api.subscribeToReviewStream(id, review.lastSeq, () => refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, review !== null]);

  // Presence (§5) isn't pushed over SSE — poll it while the review is open.
  useEffect(() => {
    if (!review || review.status !== "open") {
      setListening(null);
      return;
    }
    const poll = () => api.getPresence(id).then((p) => setListening(p.listening));
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [id, review?.status]);

  if (error) return <div className="error">Failed to load review: {error}</div>;
  if (!review) return <div className="loading">Loading review…</div>;

  const revision = review.revisions[review.revisions.length - 1];
  const selectedFile = revision.files.find((f) => f.path === selectedPath) ?? revision.files[0] ?? null;

  return (
    <div className="review">
      <header>
        <h1>{review.title}</h1>
        <span className={`status status-${review.status}`}>{review.status}</span>
      </header>
      <p className="meta">
        Revision {revision.number} · {revision.base.slice(0, 7)} → {revision.head === "WORKTREE" ? "worktree" : revision.head.slice(0, 7)}
      </p>

      <ReviewActions reviewId={id} status={review.status} notes={review.notes} listening={listening} onChanged={refresh} />

      <div className="review-body">
        <FileTree
          files={revision.files}
          threads={review.threads}
          selectedPath={selectedFile?.path ?? null}
          onSelect={setSelectedPath}
        />
        {selectedFile && (
          <DiffFile
            reviewId={id}
            revisionNumber={revision.number}
            file={selectedFile}
            threads={review.threads.filter((t) => t.anchor.path === selectedFile.path || t.currentAnchor.path === selectedFile.path)}
            onChanged={refresh}
          />
        )}
        {!selectedFile && <div className="empty">No files changed.</div>}
      </div>

      {review.status === "closed" && (
        <div className="closed-banner">
          Review closed.{" "}
          {[...review.notes].reverse().find((n) => n.kind === "summary")?.body}
        </div>
      )}
    </div>
  );
}

export function App() {
  const id = reviewIdFromPath();

  if (!id) {
    return (
      <div className="landing">
        <h1>CodeVolley</h1>
        <p>No review selected. Open a review's URL to view it here.</p>
      </div>
    );
  }

  return <ReviewView id={id} />;
}
