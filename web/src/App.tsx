import { useEffect, useState } from "react";

// Minimal mirror of the fields this view needs from shared/types.ts's Review
// shape. Duplicated rather than imported to keep the web app's build fully
// decoupled from the daemon's TS project — revisit with a shared package if
// the two drift enough to be worth the coupling.
interface RevisionFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "binary";
  oldPath?: string;
}

interface Revision {
  number: number;
  base: string;
  head: string;
  files: RevisionFile[];
}

interface Review {
  id: string;
  title: string;
  status: "open" | "closed";
  createdAt: string;
  revisions: Revision[];
}

function reviewIdFromPath(): string | null {
  const match = window.location.pathname.match(/^\/review\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function FileStatusBadge({ status }: { status: RevisionFile["status"] }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function ReviewView({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/internal/reviews/${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? `HTTP ${res.status}`);
          return;
        }
        setReview(body);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <div className="error">Failed to load review: {error}</div>;
  if (!review) return <div className="loading">Loading review…</div>;

  const revision = review.revisions[review.revisions.length - 1];

  return (
    <div className="review">
      <header>
        <h1>{review.title}</h1>
        <span className={`status status-${review.status}`}>{review.status}</span>
      </header>
      <p className="meta">
        Revision {revision.number} · {revision.base.slice(0, 7)} → {revision.head === "WORKTREE" ? "worktree" : revision.head.slice(0, 7)}
      </p>
      <ul className="file-list">
        {revision.files.map((file) => (
          <li key={file.path}>
            <FileStatusBadge status={file.status} />
            <span className="file-path">
              {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            </span>
          </li>
        ))}
        {revision.files.length === 0 && <li className="empty">No files changed.</li>}
      </ul>
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
