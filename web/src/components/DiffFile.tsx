import { Fragment, useEffect, useState } from "react";
import * as api from "../api.js";
import { buildDiffRows, type DiffRow } from "../diffRows.js";
import type { FileContent, RevisionFile, Severity, Side, Thread } from "../types.js";
import { ThreadComposer } from "./ThreadComposer.js";
import { ThreadPanel } from "./ThreadPanel.js";

interface ActiveComposer {
  side: Side;
  line: number;
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

  useEffect(() => {
    setContent(null);
    setComposer(null);
    api.getFileContent(reviewId, revisionNumber, file.path).then(setContent);
  }, [reviewId, revisionNumber, file.path]);

  if (file.status === "binary") {
    return <div className="diff-file binary-file">Binary file changed — no diff available.</div>;
  }
  if (!content) return <div className="diff-file loading">Loading diff…</div>;

  const rows = buildDiffRows(content.oldContent ?? "", content.newContent ?? "");

  // Only threads anchored (successfully, non-outdated) to the revision
  // currently on screen can be placed inline at a real line in `rows` —
  // anything else (outdated, or last matched against an older revision)
  // gets listed separately rather than guessed at.
  const inlineThreads = threads.filter((t) => t.anchorState === "current" && t.currentAnchor.revision === revisionNumber);
  const otherThreads = threads.filter((t) => !inlineThreads.includes(t));

  function threadsAt(row: DiffRow): Thread[] {
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

  return (
    <div className="diff-file">
      <div className="diff-table">
        {rows.map((row, i) => {
          const rowThreads = threadsAt(row);
          const isComposerHere =
            composer &&
            ((composer.side === "NEW" && composer.line === row.newLine) || (composer.side === "OLD" && composer.line === row.oldLine));
          return (
            <Fragment key={i}>
              <div className={`diff-row kind-${row.kind}`}>
                <div className="line-no old" onClick={() => row.oldLine !== null && setComposer({ side: "OLD", line: row.oldLine })}>
                  {row.oldLine ?? ""}
                </div>
                <div className="line-text old">
                  <span>{row.oldText}</span>
                </div>
                <div className="line-no new" onClick={() => row.newLine !== null && setComposer({ side: "NEW", line: row.newLine })}>
                  {row.newLine ?? ""}
                </div>
                <div className="line-text new">
                  <span>{row.newText}</span>
                </div>
              </div>
              {isComposerHere && (
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
        })}
      </div>

      {otherThreads.length > 0 && (
        <div className="other-threads">
          <div className="other-threads-label">Threads not shown above (outdated, or anchored to an earlier revision)</div>
          {otherThreads.map((t) => (
            <div key={t.id} className="other-thread-summary">
              <span className="severity-tag">{t.severity}</span>
              <strong>{t.title}</strong>
              <span className="thread-meta">
                {t.currentAnchor.path}:{t.currentAnchor.line} (revision {t.currentAnchor.revision})
                {t.anchorState === "outdated" && " · outdated"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
