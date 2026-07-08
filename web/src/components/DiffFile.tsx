import { Fragment, useEffect, useState } from "react";
import * as api from "../api.js";
import { buildUnifiedRows, type UnifiedRow } from "../diffRows.js";
import type { FileContent, RevisionFile, Severity, Side, Thread } from "../types.js";
import { ThreadComposer } from "./ThreadComposer.js";
import { ThreadPanel } from "./ThreadPanel.js";

interface ActiveComposer {
  side: Side;
  line: number;
}

// Unchanged lines this close to a change (or a comment) stay visible as
// context; longer runs between them get collapsed behind an expander.
const CONTEXT = 3;
// How many hidden lines each expander click reveals (shift-click reveals all).
const STEP = 10;

// How much of a collapsed gap has been revealed, from its top and its bottom.
interface Reveal {
  top: number;
  bottom: number;
}

export function DiffFile({
  reviewId,
  revisionNumber,
  file,
  threads,
  onChanged,
}: {
  reviewId: string;
  revisionNumber: number;
  file: RevisionFile;
  threads: Thread[];
  onChanged: () => void;
}) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [composer, setComposer] = useState<ActiveComposer | null>(null);
  // Keyed by a gap's first row index (stable for a given file's diff).
  const [reveals, setReveals] = useState<Map<number, Reveal>>(new Map());

  useEffect(() => {
    setContent(null);
    setComposer(null);
    setReveals(new Map());
    api.getFileContent(reviewId, revisionNumber, file.path).then(setContent);
  }, [reviewId, revisionNumber, file.path]);

  // Reveal more of a collapsed gap: `STEP` lines from one end, or (shift-click)
  // the whole thing. `len` is the gap's total hidden length.
  function digGap(key: number, len: number, side: "top" | "bottom", all: boolean) {
    setReveals((prev) => {
      const next = new Map(prev);
      const cur = prev.get(key) ?? { top: 0, bottom: 0 };
      if (all) {
        next.set(key, { top: len, bottom: 0 });
      } else if (side === "top") {
        next.set(key, { top: Math.min(cur.top + STEP, len - cur.bottom), bottom: cur.bottom });
      } else {
        next.set(key, { top: cur.top, bottom: Math.min(cur.bottom + STEP, len - cur.top) });
      }
      return next;
    });
  }

  if (file.status === "binary") {
    return <div className="diff-file binary-file">Binary file changed — no diff available.</div>;
  }
  if (!content) return <div className="diff-file loading">Loading diff…</div>;

  const rows = buildUnifiedRows(content.oldContent ?? "", content.newContent ?? "");

  // Only threads anchored (successfully, non-outdated) to the revision
  // currently on screen can be placed inline at a real line in `rows` —
  // anything else (outdated, or last matched against an older revision)
  // gets listed separately rather than guessed at.
  const inlineThreads = threads.filter((t) => t.anchorState === "current" && t.currentAnchor.revision === revisionNumber);
  const otherThreads = threads.filter((t) => !inlineThreads.includes(t));

  function threadsAt(row: UnifiedRow): Thread[] {
    return inlineThreads.filter(
      (t) =>
        (t.currentAnchor.side === "NEW" && row.newLine !== null && t.currentAnchor.line === row.newLine) ||
        (t.currentAnchor.side === "OLD" && row.oldLine !== null && t.currentAnchor.line === row.oldLine),
    );
  }

  async function submitThread(side: Side, line: number, input: { severity: Severity; title: string; body: string }) {
    await api.createThread(reviewId, { path: file.path, line, side, ...input });
    setComposer(null);
    onChanged();
  }

  function isComposerAt(row: UnifiedRow): boolean {
    return (
      !!composer &&
      ((composer.side === "NEW" && composer.line === row.newLine) || (composer.side === "OLD" && composer.line === row.oldLine))
    );
  }

  // A row "anchors" visible context if it's a change, carries a comment, or is
  // the open composer target — never collapse those or their surrounding lines.
  const anchored = rows.map((row) => row.kind !== "unchanged" || threadsAt(row).length > 0 || isComposerAt(row));
  const keep = rows.map((_, i) => {
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(rows.length - 1, i + CONTEXT); j++) {
      if (anchored[j]) return true;
    }
    return false;
  });

  // Walk the rows into a render list: kept rows verbatim; each run of hidden
  // rows shows whatever's been revealed from its top and bottom, with a gap
  // control in between for the still-hidden middle. Runs of one line aren't
  // worth hiding, so they render inline.
  type Item = { kind: "row"; index: number } | { kind: "gap"; key: number; hidden: number; len: number };
  const items: Item[] = [];
  for (let i = 0; i < rows.length; ) {
    if (keep[i]) {
      items.push({ kind: "row", index: i });
      i++;
      continue;
    }
    const start = i;
    while (i < rows.length && !keep[i]) i++;
    const end = i - 1;
    const len = end - start + 1;
    if (len <= 1) {
      for (let k = start; k <= end; k++) items.push({ kind: "row", index: k });
      continue;
    }
    const r = reveals.get(start) ?? { top: 0, bottom: 0 };
    const top = Math.min(r.top, len);
    const bottom = Math.min(r.bottom, len - top);
    const hidden = len - top - bottom;
    for (let k = start; k < start + top; k++) items.push({ kind: "row", index: k });
    if (hidden > 0) items.push({ kind: "gap", key: start, hidden, len });
    for (let k = end - bottom + 1; k <= end; k++) items.push({ kind: "row", index: k });
  }

  function renderRow(i: number) {
    const row = rows[i];
    const rowThreads = threadsAt(row);
    return (
      <Fragment key={i}>
        <div className={`diff-row kind-${row.kind}`}>
          <div className="line-no old" onClick={() => row.oldLine !== null && setComposer({ side: "OLD", line: row.oldLine })}>
            {row.oldLine ?? ""}
          </div>
          <div className="line-no new" onClick={() => row.newLine !== null && setComposer({ side: "NEW", line: row.newLine })}>
            {row.newLine ?? ""}
          </div>
          <div className="line-sign">{row.kind === "added" ? "+" : row.kind === "removed" ? "-" : ""}</div>
          <div className="line-text">
            <span>{row.text}</span>
          </div>
        </div>
        {isComposerAt(row) && composer && (
          <div className="full-row composer-row-wrapper">
            <ThreadComposer onCancel={() => setComposer(null)} onSubmit={(input) => submitThread(composer.side, composer.line, input)} />
          </div>
        )}
        {rowThreads.map((t) => (
          <div key={t.id} className="full-row thread-row">
            <ThreadPanel reviewId={reviewId} thread={t} onChanged={onChanged} />
          </div>
        ))}
      </Fragment>
    );
  }

  return (
    <div className="diff-file">
      <div className="diff-table">
        {items.map((item) =>
          item.kind === "row" ? (
            renderRow(item.index)
          ) : (
            <div key={`gap-${item.key}`} className="full-row expander-row">
              <button
                className="expander-btn"
                title="Show 10 more lines (shift-click for all)"
                onClick={(ev) => digGap(item.key, item.len, "top", ev.shiftKey)}
              >
                ↓ 10
              </button>
              <span className="expander-label">
                {item.hidden} unchanged {item.hidden === 1 ? "line" : "lines"}
              </span>
              <button
                className="expander-btn"
                title="Show 10 more lines (shift-click for all)"
                onClick={(ev) => digGap(item.key, item.len, "bottom", ev.shiftKey)}
              >
                ↑ 10
              </button>
            </div>
          ),
        )}
      </div>

      {otherThreads.length > 0 && (
        <div className="other-threads">
          <div className="other-threads-label">Threads not shown inline (outdated, or anchored to an earlier revision)</div>
          {otherThreads.map((t) => (
            <div key={t.id} className="other-thread">
              <div className="thread-meta">
                {t.currentAnchor.path}:{t.currentAnchor.line} (revision {t.currentAnchor.revision})
                {t.anchorState === "outdated" && " · outdated"}
              </div>
              <ThreadPanel reviewId={reviewId} thread={t} onChanged={onChanged} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
