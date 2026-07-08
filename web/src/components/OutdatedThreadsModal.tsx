import { useEffect } from "react";
import type { Thread } from "../types.js";
import { ThreadPanel } from "./ThreadPanel.js";

// Modal listing a file's outdated / earlier-revision threads (the ones that
// can't be placed inline against the current revision), opened from the count
// badge in the file header.
export function OutdatedThreadsModal({
  reviewId,
  path,
  threads,
  claudeWorking,
  onChanged,
  onClose,
}: {
  reviewId: string;
  path: string;
  threads: Thread[];
  claudeWorking: boolean;
  onChanged: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <strong>
            {threads.length} outdated {threads.length === 1 ? "thread" : "threads"} · {path}
          </strong>
          <button className="modal-close" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          {threads.map((t) => (
            <div key={t.id} className="other-thread">
              <div className="thread-meta">
                {t.currentAnchor.path}:{t.currentAnchor.line} (revision {t.currentAnchor.revision})
                {t.anchorState === "outdated" && " · outdated"}
              </div>
              <ThreadPanel reviewId={reviewId} thread={t} claudeWorking={claudeWorking} onChanged={onChanged} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
