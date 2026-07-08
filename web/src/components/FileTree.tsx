import { Fragment } from "react";
import type { FileGroup } from "../sections.js";
import type { RevisionFile, Thread } from "../types.js";

export function FileTree({
  groups,
  threads,
  selectedPath,
  onSelect,
}: {
  groups: FileGroup[];
  threads: Thread[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  function inFile(t: Thread, path: string): boolean {
    return t.currentAnchor.path === path || t.anchor.path === path;
  }
  function openThreadCount(path: string): number {
    return threads.filter((t) => t.status === "open" && inFile(t, path)).length;
  }
  function outdatedThreadCount(path: string): number {
    return threads.filter((t) => t.anchorState === "outdated" && inFile(t, path)).length;
  }

  function fileItem(f: RevisionFile) {
    const count = openThreadCount(f.path);
    const outdated = outdatedThreadCount(f.path);
    return (
      <li key={f.path} className={f.path === selectedPath ? "selected" : ""} onClick={() => onSelect(f.path)}>
        <span className={`badge badge-${f.status}`}>{f.status}</span>
        <span className="file-path">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
        {outdated > 0 && (
          <span className="thread-count outdated" title={`${outdated} outdated thread${outdated === 1 ? "" : "s"}`}>
            {outdated}
          </span>
        )}
        {count > 0 && (
          <span className="thread-count" title={`${count} open thread${count === 1 ? "" : "s"}`}>
            {count}
          </span>
        )}
      </li>
    );
  }

  return (
    <ul className="file-tree">
      {groups.map((group) => (
        <Fragment key={group.name ?? "__all"}>
          {group.name && <li className="file-tree-section">{group.name}</li>}
          {group.files.map(fileItem)}
        </Fragment>
      ))}
    </ul>
  );
}
