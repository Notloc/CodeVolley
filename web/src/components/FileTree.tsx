import { Fragment, useState } from "react";
import type { FileGroup } from "../sections.js";
import type { RevisionFile, Thread } from "../types.js";

export function FileTree({
  groups,
  threads,
  selectedPath,
  onSelect,
  sectionFilter,
  onFilterSection,
}: {
  groups: FileGroup[];
  threads: Thread[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  sectionFilter: string | null;
  onFilterSection: (name: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggleSection(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

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
      {groups.map((group) => {
        const isCollapsed = group.name !== null && collapsed.has(group.name);
        const isFiltered = group.name !== null && sectionFilter === group.name;
        const hidden = sectionFilter !== null && group.name !== sectionFilter;
        return (
          <Fragment key={group.name ?? "__all"}>
            {group.name && (
              <li className={`file-tree-section${isFiltered ? " filtered" : ""}`} onClick={() => toggleSection(group.name!)}>
                <span className="collapse-caret">{isCollapsed ? "▸" : "▾"}</span>
                {group.name}
                <span className="section-count">{group.files.length}</span>
                <button
                  className={`section-filter${isFiltered ? " active" : ""}`}
                  title={isFiltered ? "Show all sections" : `Show only ${group.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFilterSection(group.name!);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              </li>
            )}
            {!isCollapsed && !hidden && group.files.map(fileItem)}
          </Fragment>
        );
      })}
    </ul>
  );
}
