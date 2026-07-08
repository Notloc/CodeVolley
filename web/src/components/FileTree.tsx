import type { RevisionFile, Thread } from "../types.js";

export function FileTree({
  files,
  threads,
  selectedPath,
  onSelect,
}: {
  files: RevisionFile[];
  threads: Thread[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  function openThreadCount(path: string): number {
    return threads.filter((t) => t.status === "open" && (t.currentAnchor.path === path || t.anchor.path === path)).length;
  }

  return (
    <ul className="file-tree">
      {files.map((f) => {
        const count = openThreadCount(f.path);
        return (
          <li key={f.path} className={f.path === selectedPath ? "selected" : ""} onClick={() => onSelect(f.path)}>
            <span className={`badge badge-${f.status}`}>{f.status}</span>
            <span className="file-path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
            {count > 0 && <span className="thread-count">{count}</span>}
          </li>
        );
      })}
    </ul>
  );
}
