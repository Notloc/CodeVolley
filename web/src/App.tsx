import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "./api.js";
import { DiffFile } from "./components/DiffFile.js";
import { FileTree } from "./components/FileTree.js";
import { ReviewActions } from "./components/ReviewActions.js";
import { ReviewPicker } from "./components/ReviewPicker.js";
import type { Review, RevisionFile, Thread } from "./types.js";

function reviewIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/review\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Dark app bar so the off-white "Volley" and the colourful ball read cleanly
// regardless of the page's light/dark theme.
function TopBar() {
  return (
    <div className="app-bar">
      <a className="brand" href="/">
        <span className="brand-word">
          <span className="brand-code">Code</span>
          <span className="brand-volley">Volley</span>
        </span>
        <img className="brand-ball" src="/code-volley-icon.svg" alt="" width="48" height="48" />
      </a>
    </div>
  );
}

// Mounts its children only once they scroll near the viewport, so a review
// with hundreds of files (or a 20k-line change) doesn't build every diff up
// front — off-screen files stay cheap placeholders until you reach them.
function LazyMount({ minHeight, children }: { minHeight: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [shown]);

  return <div ref={ref}>{shown ? children : <div className="diff-placeholder" style={{ minHeight }} />}</div>;
}

function fileAnchorId(path: string): string {
  return `file-${path}`;
}

function FileSection({
  reviewId,
  revisionNumber,
  file,
  threads,
  claudeWorking,
  onChanged,
}: {
  reviewId: string;
  revisionNumber: number;
  file: RevisionFile;
  threads: Thread[];
  claudeWorking: boolean;
  onChanged: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section id={fileAnchorId(file.path)} className={`file-section${collapsed ? " collapsed" : ""}`}>
      <button className="file-section-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="collapse-caret">{collapsed ? "▸" : "▾"}</span>
        <span className={`badge badge-${file.status}`}>{file.status}</span>
        <span className="file-section-path">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
      </button>
      {!collapsed && (
        <LazyMount minHeight={120}>
          <DiffFile
            reviewId={reviewId}
            revisionNumber={revisionNumber}
            file={file}
            threads={threads}
            claudeWorking={claudeWorking}
            onChanged={onChanged}
          />
        </LazyMount>
      )}
    </section>
  );
}

function ReviewView({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [listening, setListening] = useState<boolean | null>(null);
  const [online, setOnline] = useState(false);

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
      setOnline(false);
      return;
    }
    const poll = () =>
      api.getPresence(id).then((p) => {
        setListening(p.listening);
        setOnline(p.online);
      });
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [id, review?.status]);

  if (error) return <div className="error">Failed to load review: {error}</div>;
  if (!review) return <div className="loading">Loading review…</div>;

  const revision = review.revisions[review.revisions.length - 1];

  // Claude is actively working this review (online session, not parked in a
  // wait) — drives the "replying…" spinner on threads awaiting a reply.
  const claudeWorking = review.status === "open" && online && listening === false;

  const scrollToFile = (path: string) => {
    setSelectedPath(path);
    document.getElementById(fileAnchorId(path))?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <TopBar />
      <div className="review">
      <a className="back-link" href="/">
        ← All reviews
      </a>
      <header>
        <h1>{review.title}</h1>
        <span className={`status status-${review.status}`}>{review.status}</span>
      </header>
      <p className="meta">
        Revision {revision.number} · {revision.base.slice(0, 7)} → {revision.head === "WORKTREE" ? "worktree" : revision.head.slice(0, 7)}
      </p>

      <ReviewActions reviewId={id} status={review.status} notes={review.notes} listening={listening} onChanged={refresh} />

      <div className="review-body">
        <FileTree files={revision.files} threads={review.threads} selectedPath={selectedPath} onSelect={scrollToFile} />
        {revision.files.length === 0 ? (
          <div className="empty">No files changed.</div>
        ) : (
          <div className="diff-stack">
            {revision.files.map((f) => (
              <FileSection
                key={f.path}
                reviewId={id}
                revisionNumber={revision.number}
                file={f}
                threads={review.threads.filter((t) => t.anchor.path === f.path || t.currentAnchor.path === f.path)}
                claudeWorking={claudeWorking}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>

      {review.status === "closed" && (
        <div className="closed-banner">
          Review closed.{" "}
          {[...review.notes].reverse().find((n) => n.kind === "summary")?.body}
        </div>
      )}
      </div>
    </>
  );
}

export function App() {
  const id = reviewIdFromPath();

  if (!id) {
    return (
      <>
        <TopBar />
        <div className="landing">
          <ReviewPicker />
        </div>
      </>
    );
  }

  return <ReviewView id={id} />;
}
