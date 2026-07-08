import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as api from "./api.js";
import { DiffFile } from "./components/DiffFile.js";
import { FileTree } from "./components/FileTree.js";
import { OutdatedThreadsModal } from "./components/OutdatedThreadsModal.js";
import { ReviewActions } from "./components/ReviewActions.js";
import { ReviewPicker } from "./components/ReviewPicker.js";
import { FILE_STATUS_SYMBOL } from "./fileStatus.js";
import { orderedFiles } from "./fileTree.js";
import { groupFiles, type Section } from "./sections.js";
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
  const [showOutdated, setShowOutdated] = useState(false);

  // Threads that can't be placed inline against the current revision (outdated
  // or anchored to an earlier revision) — surfaced via a header badge + modal.
  const outdated = threads.filter((t) => !(t.anchorState === "current" && t.currentAnchor.revision === revisionNumber));

  return (
    <section id={fileAnchorId(file.path)} className={`file-section${collapsed ? " collapsed" : ""}`}>
      <div className="file-section-header" onClick={() => setCollapsed((c) => !c)}>
        <span className="collapse-caret">{collapsed ? "▸" : "▾"}</span>
        <span className={`badge badge-${file.status}`} title={file.status}>{FILE_STATUS_SYMBOL[file.status]}</span>
        <span className="file-section-path">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
        {outdated.length > 0 && (
          <button
            className="outdated-badge"
            title="Show outdated threads"
            onClick={(e) => {
              e.stopPropagation();
              setShowOutdated(true);
            }}
          >
            {outdated.length} outdated
          </button>
        )}
      </div>
      {showOutdated && (
        <OutdatedThreadsModal
          reviewId={reviewId}
          path={file.path}
          threads={outdated}
          claudeWorking={claudeWorking}
          onChanged={onChanged}
          onClose={() => setShowOutdated(false)}
        />
      )}
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
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getReview(id).then(setReview).catch((err) => setError(String(err.message ?? err)));
  }, [id]);

  useEffect(refresh, [refresh]);

  // Per-workspace file-tree sections (config.json). Fetched once; empty until
  // configured, in which case the tree/stack render flat as before.
  useEffect(() => {
    api.getConfig().then((c) => setSections(c.sections)).catch(() => setSections([]));
  }, []);

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

  // Scroll-spy: highlight whichever file is front-and-center in the viewport.
  // Every file's `.file-section` wrapper is always in the DOM (even lazy ones),
  // so we pick the section whose top is closest above a reference line.
  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const refY = window.innerHeight * 0.35;
      let active: string | null = null;
      let activeTop = -Infinity;
      for (const el of document.querySelectorAll<HTMLElement>(".file-section")) {
        const top = el.getBoundingClientRect().top;
        if (top <= refY && top > activeTop) {
          activeTop = top;
          active = el.id.slice("file-".length);
        }
      }
      const first = document.querySelector<HTMLElement>(".file-section");
      if (!active && first) active = first.id.slice("file-".length);
      if (active) setSelectedPath((prev) => (prev === active ? prev : active));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    compute();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, review !== null]);

  if (error) return <div className="error">Failed to load review: {error}</div>;
  if (!review) return <div className="loading">Loading review…</div>;

  const revision = review.revisions[review.revisions.length - 1];

  // Group files into workspace sections (flat single group when unconfigured).
  // The stack renders in the same grouped order so it matches the tree.
  const groups = groupFiles(revision.files, sections);
  // When a section is soloed via its eye toggle, the stack shows only it.
  const stackGroups = sectionFilter ? groups.filter((g) => g.name === sectionFilter) : groups;
  const toggleSectionFilter = (name: string) => setSectionFilter((prev) => (prev === name ? null : name));

  // Claude is actively working this review (online session, not parked in a
  // wait) — drives the "replying…" spinner on threads awaiting a reply.
  const claudeWorking = review.status === "open" && online && listening === false;

  const scrollToFile = (path: string) => {
    setSelectedPath(path);
    // Lazily-mounting file sections grow from their placeholder height as we
    // scroll past them, shifting the target — so a single smooth scroll lands
    // short. Re-snap to the target until its position stops moving.
    const id = fileAnchorId(path);
    let lastTop = NaN;
    let stable = 0;
    const startedAt = Date.now();
    const settle = () => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = Math.round(el.getBoundingClientRect().top);
      if (Math.abs(top) > 2) el.scrollIntoView({ block: "start" });
      stable = top === lastTop ? stable + 1 : 0;
      lastTop = top;
      if (stable < 3 && Date.now() - startedAt < 2500) setTimeout(settle, 60);
    };
    settle();
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
        <FileTree
          groups={groups}
          threads={review.threads}
          selectedPath={selectedPath}
          onSelect={scrollToFile}
          sectionFilter={sectionFilter}
          onFilterSection={toggleSectionFilter}
        />
        {revision.files.length === 0 ? (
          <div className="empty">No files changed.</div>
        ) : (
          <div className="diff-stack">
            {stackGroups.map((group) => (
              <div key={group.name ?? "__all"} className="stack-group">
                {group.name && <div className="stack-section">{group.name}</div>}
                {orderedFiles(group.files).map((f) => (
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
