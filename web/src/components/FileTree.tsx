import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { FILE_STATUS_SYMBOL } from "../fileStatus.js";
import { buildFileTree, type TreeNode } from "../fileTree.js";
import type { FileGroup } from "../sections.js";
import type { Thread } from "../types.js";

const INDENT_REM = 0.85;

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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the highlighted (front-and-center) file visible within the tree's own
  // scroll area — nudging only when it's off-screen, and only the tree's
  // scrollTop so the page isn't affected.
  useEffect(() => {
    const container = listRef.current;
    const el = container?.querySelector<HTMLElement>("li.selected");
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.top < c.top) container.scrollTop -= c.top - e.top + 8;
    else if (e.bottom > c.bottom) container.scrollTop += e.bottom - c.bottom + 8;
  }, [selectedPath]);

  function toggle(setter: (fn: (prev: Set<string>) => Set<string>) => void, key: string) {
    setter((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
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

  function indentStyle(depth: number) {
    return { paddingLeft: `calc(0.4rem + ${depth * INDENT_REM}rem)` };
  }

  function renderNodes(nodes: TreeNode[], depth: number, groupKey: string): ReactNode[] {
    const out: ReactNode[] = [];
    for (const node of nodes) {
      if (node.type === "dir") {
        const key = `${groupKey}:${node.path}`;
        const isCollapsed = collapsedDirs.has(key);
        out.push(
          <li key={`d:${key}`} className="file-tree-dir" style={indentStyle(depth)} onClick={() => toggle(setCollapsedDirs, key)}>
            <span className="collapse-caret">{isCollapsed ? "▸" : "▾"}</span>
            <span className="file-path" title={node.path}>
              {node.name}
            </span>
          </li>,
        );
        if (!isCollapsed) out.push(...renderNodes(node.children, depth + 1, groupKey));
      } else {
        const f = node.file;
        const count = openThreadCount(f.path);
        const outdated = outdatedThreadCount(f.path);
        out.push(
          <li
            key={`f:${f.path}`}
            className={f.path === selectedPath ? "selected" : ""}
            style={indentStyle(depth)}
            onClick={() => onSelect(f.path)}
          >
            <span className={`badge badge-${f.status}`} title={f.status}>
              {FILE_STATUS_SYMBOL[f.status]}
            </span>
            <span className="file-path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              {node.name}
            </span>
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
          </li>,
        );
      }
    }
    return out;
  }

  return (
    <ul className="file-tree" ref={listRef}>
      {groups.map((group) => {
        const groupKey = group.name ?? "__all";
        const isSectionCollapsed = group.name !== null && collapsedSections.has(group.name);
        const isFiltered = group.name !== null && sectionFilter === group.name;
        const hiddenByFilter = sectionFilter !== null && group.name !== sectionFilter;
        return (
          <Fragment key={groupKey}>
            {group.name && (
              <li className={`file-tree-section${isFiltered ? " filtered" : ""}`} onClick={() => toggle(setCollapsedSections, group.name!)}>
                <span className="collapse-caret">{isSectionCollapsed ? "▸" : "▾"}</span>
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
            {!isSectionCollapsed && !hiddenByFilter && renderNodes(buildFileTree(group.files), 0, groupKey)}
          </Fragment>
        );
      })}
    </ul>
  );
}
