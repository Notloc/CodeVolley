import { Fragment, useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { buildUnifiedRows } from "../diffRows.js";
import type { Actor, FileContent, ReviewEvent, Severity, Thread, ThreadStatus } from "../types.js";
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

// The feed is a timeline of entries derived from the review's event log:
// a thread's creation renders as its full card; later activity on it (and
// review-level events) render as compact action rows. A resolution therefore
// surfaces as fresh activity at the top instead of quietly collapsing a card
// buried at its creation spot.
interface ThreadEntry {
  kind: "thread";
  key: string;
  at: number;
  seq: number;
  thread: Thread;
}
interface ActionEntry {
  kind: "action";
  key: string;
  at: number;
  seq: number;
  actor: Actor;
  verb: string;
  // Colours the row's status dot: resolved | open | wontfix | revision | review.
  dot: string;
  threadId?: string;
  threadTitle?: string;
  // Lets the type filter apply to a thread's activity too; review-level
  // rows (revisions, close/reopen) have none and always show.
  severity?: Severity;
}
type Entry = ThreadEntry | ActionEntry;

const STATUS_VERB: Record<ThreadStatus, string> = {
  resolved: "resolved",
  wontfix: "marked won't fix on",
  open: "reopened",
};

function buildEntries(events: ReviewEvent[], threads: Thread[]): Entry[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const carded = new Set<string>();
  const out: Entry[] = [];

  for (const e of events) {
    const at = Date.parse(e.createdAt);
    if (e.type === "thread_created") {
      const id = (e.payload as { id?: string }).id;
      const thread = id ? byId.get(id) : undefined;
      if (thread) {
        out.push({ kind: "thread", key: `t-${thread.id}`, at, seq: e.seq, thread });
        carded.add(thread.id);
      }
    } else if (e.type === "thread_status_changed") {
      const p = e.payload as { thread?: string; status?: ThreadStatus; title?: string };
      if (!p.thread || !p.status) continue;
      const live = byId.get(p.thread);
      out.push({
        kind: "action",
        key: `e-${e.seq}`,
        at,
        seq: e.seq,
        actor: e.actor,
        verb: STATUS_VERB[p.status],
        dot: p.status,
        threadId: p.thread,
        // Prefer the live title (it can be edited); the payload snapshot
        // covers threads that somehow left the review.
        threadTitle: live?.title ?? p.title ?? p.thread,
        severity: live?.severity,
      });
    } else if (e.type === "revision_submitted") {
      const p = e.payload as { revision?: number };
      out.push({
        kind: "action",
        key: `e-${e.seq}`,
        at,
        seq: e.seq,
        actor: e.actor,
        verb: `submitted revision ${p.revision ?? "?"}`,
        dot: "revision",
      });
    } else if (e.type === "review_closed" || e.type === "review_reopened") {
      out.push({
        kind: "action",
        key: `e-${e.seq}`,
        at,
        seq: e.seq,
        actor: e.actor,
        verb: e.type === "review_closed" ? "closed the review" : "reopened the review",
        dot: "review",
      });
    }
  }

  // The events fetch can lag the review fetch by a beat — threads whose
  // created event hasn't arrived yet still get a card at their creation time.
  for (const t of threads) {
    if (!carded.has(t.id)) out.push({ kind: "thread", key: `t-${t.id}`, at: createdAtMs(t), seq: 0, thread: t });
  }

  out.sort((a, b) => b.at - a.at || b.seq - a.seq);
  return out;
}

// One feed entry: a mini diff snippet around the thread's anchor (rendered
// with the same row markup/classes as DiffFile) with the thread panel inline
// beneath its line, plus a path:line link out to the Details tab.
function ThreadCard({
  reviewId,
  revisionNumber,
  thread,
  claudeWorking,
  focusNonce,
  onChanged,
  onJump,
}: {
  reviewId: string;
  revisionNumber: number;
  thread: Thread;
  claudeWorking: boolean;
  // Bumped when an action row's thread link targets this card: expand + flash.
  focusNonce: number;
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

  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!focusNonce) return;
    setOverride(true);
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(timer);
  }, [focusNonce]);

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
    <article
      className={`thread-card status-${thread.status} severity-${thread.severity}${expanded ? "" : " collapsed"}${flash ? " flash" : ""}`}
    >
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
  lastSeq,
  threads,
  claudeWorking,
  active,
  onChanged,
  onJumpToThread,
}: {
  reviewId: string;
  revisionNumber: number;
  // Bumps on every review event — cue to refetch the event log.
  lastSeq: number;
  threads: Thread[];
  claudeWorking: boolean;
  // Whether this tab is the visible one — hidden tabs can merge new entries
  // silently since there's no reader to disturb.
  active: boolean;
  onChanged: () => void;
  onJumpToThread: (thread: Thread) => void;
}) {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .getEvents(reviewId)
      .then((e) => {
        if (!cancelled) setEvents(e);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reviewId, lastSeq]);

  const entries = useMemo(() => buildEntries(events, threads), [events, threads]);

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
  const matchesFilter = (e: Entry) => {
    if (typeFilter.size === 0) return true;
    if (e.kind === "thread") return typeFilter.has(e.thread.severity);
    return e.severity === undefined || typeFilter.has(e.severity);
  };
  const filtered = entries.filter(matchesFilter);

  const typeCounts = useMemo(() => {
    const counts = new Map<Severity, number>();
    for (const t of threads) counts.set(t.severity, (counts.get(t.severity) ?? 0) + 1);
    return counts;
  }, [threads]);

  // Anti-jarring: entries that arrive while the user is scrolled into the feed
  // (reading or mid-reply) are held out of the list — a sticky "N new" pill
  // reveals them. Near the top (or with the tab hidden) they merge straight
  // in, which is the "newest appear as they come in" behaviour.
  const [shownKeys, setShownKeys] = useState<Set<string> | null>(null);
  useEffect(() => {
    setShownKeys((prev) => {
      const keys = new Set(entries.map((e) => e.key));
      if (prev === null) return keys;
      if (!entries.some((e) => !prev.has(e.key))) return prev;
      if (!active || window.scrollY < 120) return keys;
      return prev;
    });
  }, [entries, active]);

  const held = shownKeys === null ? [] : filtered.filter((e) => !shownKeys.has(e.key));
  const visible = shownKeys === null ? filtered : filtered.filter((e) => shownKeys.has(e.key));

  const revealHeld = () => {
    setShownKeys(new Set(entries.map((e) => e.key)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Action-row thread links land on the thread's card in this feed: settle
  // scroll to its (always-mounted) wrapper, then have the card expand and
  // flash via focusNonce. Same re-snap loop as the Details jumps — cards
  // above grow from their lazy placeholders while we scroll past them.
  const [focus, setFocus] = useState<{ id: string; nonce: number }>({ id: "", nonce: 0 });
  const focusThread = (threadId: string) => {
    setFocus((f) => ({ id: threadId, nonce: f.nonce + 1 }));
    let lastTop = NaN;
    let stable = 0;
    const startedAt = Date.now();
    const settle = () => {
      const el = document.getElementById(`card-${threadId}`);
      if (el) {
        const target = Math.round(window.innerHeight * 0.25);
        const top = Math.round(el.getBoundingClientRect().top);
        if (Math.abs(top - target) > 2) window.scrollBy(0, top - target);
        stable = top === lastTop ? stable + 1 : 0;
        lastTop = top;
      }
      if (stable < 3 && Date.now() - startedAt < 2500) setTimeout(settle, 60);
    };
    settle();
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
            ↑ {held.length} new {held.length === 1 ? "update" : "updates"}
          </button>
        )}
        {entries.length === 0 ? (
          <div className="empty overview-empty">No activity yet — threads will appear here as they come in.</div>
        ) : filtered.length === 0 ? (
          <div className="empty overview-empty">No threads of the selected types.</div>
        ) : (
          visible.map((e) =>
            e.kind === "thread" ? (
              <div key={e.key} id={`card-${e.thread.id}`}>
                <LazyMount minHeight={180}>
                  <ThreadCard
                    reviewId={reviewId}
                    revisionNumber={revisionNumber}
                    thread={e.thread}
                    claudeWorking={claudeWorking}
                    focusNonce={focus.id === e.thread.id ? focus.nonce : 0}
                    onChanged={onChanged}
                    onJump={() => onJumpToThread(e.thread)}
                  />
                </LazyMount>
              </div>
            ) : (
              <div key={e.key} className={`action-row dot-${e.dot}`}>
                <span className="action-dot" />
                <span className="action-text">
                  <strong className={`action-actor actor-${e.actor}`}>{e.actor === "claude" ? "Claude" : "User"}</strong> {e.verb}
                  {e.threadId && (
                    <>
                      {" "}
                      <button className="action-thread-link" onClick={() => focusThread(e.threadId!)}>
                        {e.threadTitle}
                      </button>
                    </>
                  )}
                </span>
                <span className="action-time">{timeAgo(e.at)}</span>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
