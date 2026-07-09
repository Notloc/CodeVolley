import { Fragment, useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { buildUnifiedRows } from "../diffRows.js";
import type { FileContent, Severity, Thread } from "../types.js";
import { LazyMount } from "./LazyMount.js";
import { ThreadPanel } from "./ThreadPanel.js";

// Sidebar order for the type filter.
const SEVERITIES: Severity[] = ["issue", "suggestion", "question", "nit", "praise"];

// Lines of code shown above/below a thread's anchor line in its feed card —
// enough to orient the reader; the header link covers "I need more context".
const SNIPPET_CONTEXT = 4;

function createdAtMs(t: Thread): number {
  return t.comments.length > 0 ? Date.parse(t.comments[0].createdAt) : 0;
}

function timeAgo(ms: number): string {
  const mins = (Date.now() - ms) / 60_000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return new Date(ms).toLocaleDateString();
}

// One feed entry: a mini diff snippet around the thread's anchor (rendered
// with the same row markup/classes as DiffFile) with the thread panel inline
// beneath its line, plus a path:line link out to the Details tab.
function ThreadCard({
  reviewId,
  revisionNumber,
  thread,
  claudeWorking,
  onChanged,
  onJump,
}: {
  reviewId: string;
  revisionNumber: number;
  thread: Thread;
  claudeWorking: boolean;
  onChanged: () => void;
  onJump: () => void;
}) {
  const anchor = thread.currentAnchor;
  // Anchored to an older revision (or outdated) — snippet comes from the
  // revision it last matched, flagged in the header.
  const stale = !(thread.anchorState === "current" && anchor.revision === revisionNumber);
  const [content, setContent] = useState<FileContent | null>(null);

  // The card itself is the collapsible unit (the panel inside renders bare).
  // Default follows status — resolved/wontfix start collapsed — and a status
  // transition resets any manual override, so resolving auto-collapses.
  const [override, setOverride] = useState<boolean | null>(null);
  useEffect(() => {
    setOverride(null);
  }, [thread.status]);
  const expanded = override ?? thread.status === "open";

  useEffect(() => {
    setContent(null);
  }, [reviewId, anchor.revision, anchor.path]);

  // Fetch lazily on first expand — a feed of collapsed resolved threads
  // shouldn't pull file contents it never shows.
  useEffect(() => {
    if (!expanded || content !== null) return;
    let cancelled = false;
    api
      .getFileContent(reviewId, anchor.revision, anchor.path)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch(() => {
        // Snippet is best-effort; the card still renders the thread.
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, content, reviewId, anchor.revision, anchor.path]);

  const snippet = useMemo(() => {
    if (!content) return null;
    const rows = buildUnifiedRows(content.oldContent ?? "", content.newContent ?? "");
    const idx = rows.findIndex((r) => (anchor.side === "NEW" ? r.newLine === anchor.line : r.oldLine === anchor.line));
    if (idx === -1) return null;
    const start = Math.max(0, idx - SNIPPET_CONTEXT);
    return { rows: rows.slice(start, Math.min(rows.length, idx + SNIPPET_CONTEXT + 1)), anchorIdx: idx - start };
  }, [content, anchor.side, anchor.line]);

  const panel = <ThreadPanel reviewId={reviewId} thread={thread} claudeWorking={claudeWorking} onChanged={onChanged} bare />;

  return (
    <article className={`thread-card status-${thread.status} severity-${thread.severity}${expanded ? "" : " collapsed"}`}>
      <div className="thread-card-header" onClick={() => setOverride(!expanded)}>
        <span className="collapse-caret">{expanded ? "▾" : "▸"}</span>
        <span className="thread-status-tag">{thread.status}</span>
        <strong className="thread-card-title">{thread.title}</strong>
        <span className="severity-tag">{thread.severity}</span>
        {thread.anchorState === "outdated" && <span className="outdated-tag">outdated</span>}
        <button
          className="thread-card-link"
          title={`${anchor.path}:${anchor.line} — open in the Details tab`}
          onClick={(e) => {
            e.stopPropagation();
            onJump();
          }}
        >
          <span className="link-dir">{anchor.path.slice(0, anchor.path.lastIndexOf("/") + 1)}</span>
          <span className="link-file">
            {anchor.path.slice(anchor.path.lastIndexOf("/") + 1)}:{anchor.line}
          </span>
        </button>
        {stale && <span className="thread-card-rev">rev {anchor.revision}</span>}
        <span className="thread-card-time">{timeAgo(createdAtMs(thread))}</span>
      </div>
      {!expanded ? null : snippet ? (
        <div className="diff-file">
          <div className="diff-table">
            {snippet.rows.map((row, i) => (
              <Fragment key={i}>
                <div className={`diff-row kind-${row.kind}`}>
                  <div className="line-no old">{row.oldLine ?? ""}</div>
                  <div className="line-no new">{row.newLine ?? ""}</div>
                  <div className="line-sign">{row.kind === "added" ? "+" : row.kind === "removed" ? "-" : ""}</div>
                  <div className="line-text">
                    <span>{row.text}</span>
                  </div>
                </div>
                {i === snippet.anchorIdx && (
                  <div className="full-row">
                    <div className={`pinned thread-row kind-${row.kind}`}>{panel}</div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div className="thread-card-body">{panel}</div>
      )}
    </article>
  );
}

export function OverviewTab({
  reviewId,
  revisionNumber,
  threads,
  claudeWorking,
  active,
  onChanged,
  onJumpToThread,
}: {
  reviewId: string;
  revisionNumber: number;
  threads: Thread[];
  claudeWorking: boolean;
  // Whether this tab is the visible one — hidden tabs can merge new threads
  // silently since there's no reader to disturb.
  active: boolean;
  onChanged: () => void;
  onJumpToThread: (thread: Thread) => void;
}) {
  // Newest first, keyed on creation time so replies/status changes update a
  // card in place without reordering the feed under the reader.
  const sorted = useMemo(() => [...threads].sort((a, b) => createdAtMs(b) - createdAtMs(a)), [threads]);

  // Type filter: empty set = no filter (all types). Clicking types builds up
  // the applicable set; "All threads" (or unticking the last type) resets.
  const [typeFilter, setTypeFilter] = useState<Set<Severity>>(new Set());
  const toggleType = (s: Severity) =>
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const filtered = typeFilter.size === 0 ? sorted : sorted.filter((t) => typeFilter.has(t.severity));

  const typeCounts = useMemo(() => {
    const counts = new Map<Severity, number>();
    for (const t of threads) counts.set(t.severity, (counts.get(t.severity) ?? 0) + 1);
    return counts;
  }, [threads]);

  // Anti-jarring: threads that arrive while the user is scrolled into the feed
  // (reading or mid-reply) are held out of the list — a sticky "N new threads"
  // pill reveals them. Near the top (or with the tab hidden) they merge
  // straight in, which is the "newest appear as they come in" behaviour.
  const [shownIds, setShownIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    setShownIds((prev) => {
      const ids = new Set(threads.map((t) => t.id));
      if (prev === null) return ids;
      if (!threads.some((t) => !prev.has(t.id))) return prev;
      if (!active || window.scrollY < 120) return ids;
      return prev;
    });
  }, [threads, active]);

  const held = shownIds === null ? [] : filtered.filter((t) => !shownIds.has(t.id));
  const visible = shownIds === null ? filtered : filtered.filter((t) => shownIds.has(t.id));

  const revealHeld = () => {
    setShownIds(new Set(threads.map((t) => t.id)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="overview-body">
      <ul className="type-filter">
        <li className={typeFilter.size === 0 ? "active" : ""} onClick={() => setTypeFilter(new Set())}>
          All threads
          <span className="type-count">{threads.length}</span>
        </li>
        {SEVERITIES.map((s) => (
          <li key={s} className={typeFilter.has(s) ? "active" : ""} onClick={() => toggleType(s)}>
            <span className={`type-dot sev-${s}`} />
            {s}
            <span className="type-count">{typeCounts.get(s) ?? 0}</span>
          </li>
        ))}
      </ul>
      <div className="overview-feed">
        {held.length > 0 && (
          <button className="new-threads-pill" onClick={revealHeld}>
            ↑ {held.length} new {held.length === 1 ? "thread" : "threads"}
          </button>
        )}
        {sorted.length === 0 ? (
          <div className="empty overview-empty">No threads yet — comments will appear here as they come in.</div>
        ) : filtered.length === 0 ? (
          <div className="empty overview-empty">No threads of the selected types.</div>
        ) : (
          visible.map((t) => (
            <LazyMount key={t.id} minHeight={180}>
              <ThreadCard
                reviewId={reviewId}
                revisionNumber={revisionNumber}
                thread={t}
                claudeWorking={claudeWorking}
                onChanged={onChanged}
                onJump={() => onJumpToThread(t)}
              />
            </LazyMount>
          ))
        )}
      </div>
    </div>
  );
}
