import { type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { FILE_STATUS_LETTER } from "../fileStatus.js";
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
  // Thread-badge hover tooltip. Fixed-position (viewport coords) because the
  // tree's own scroll container would clip an absolutely-positioned popover.
  const [tip, setTip] = useState<{ x: number; y: number; path: string } | null>(null);
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
  // The badge counts threads still asking for attention: open ones plus
  // outdated ones (deduped — an open thread can also be outdated).
  function attentionThreads(path: string): Thread[] {
    return threads.filter((t) => inFile(t, path) && (t.status === "open" || t.anchorState === "outdated"));
  }

  // Indentation plus VS Code-style guide rails: one 1px line under each
  // ancestor level, drawn as a repeating gradient clipped to the indent area
  // (inline longhands, so the stylesheet's hover/selected `background`
  // shorthand can't wipe them).
  function indentStyle(depth: number) {
    const style: CSSProperties = { paddingLeft: `calc(0.4rem + ${depth * INDENT_REM}rem)` };
    if (depth > 0) {
      style.backgroundImage = `repeating-linear-gradient(to right, var(--border) 0 1px, transparent 1px ${INDENT_REM}rem)`;
      style.backgroundPosition = "0.7rem 0";
      style.backgroundSize = `calc(${(depth - 1) * INDENT_REM}rem + 1px) 100%`;
      style.backgroundRepeat = "no-repeat";
    }
    return style;
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
        const attention = attentionThreads(f.path);
        const anyOpen = attention.some((t) => t.status === "open");
        out.push(
          <li
            key={`f:${f.path}`}
            className={f.path === selectedPath ? "selected" : ""}
            style={indentStyle(depth)}
            onClick={() => onSelect(f.path)}
          >
            <span className={`status-letter letter-${f.status}`} title={f.status}>
              {FILE_STATUS_LETTER[f.status]}
            </span>
            <span className="file-path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              {node.name}
            </span>
            {attention.length > 0 && (
              <span
                className={`thread-badge${anyOpen ? "" : " muted"}`}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTip({ x: rect.right + 8, y: rect.top + rect.height / 2, path: f.path });
                }}
                onMouseLeave={() => setTip(null)}
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {attention.length}
              </span>
            )}
          </li>,
        );
      }
    }
    return out;
  }

  // Hover detail for the combined badge: one row per counted thread (status
  // dot + severity + title, outdated flagged), plus a muted tally of the
  // file's closed threads that aren't counted.
  function renderTooltip() {
    if (!tip) return null;
    const items = attentionThreads(tip.path);
    if (items.length === 0) return null;
    const closed = threads.filter((t) => inFile(t, tip.path)).length - items.length;
    return (
      <div className="tree-tooltip" style={{ left: tip.x, top: tip.y }}>
        {items.map((t) => (
          <div key={t.id} className="tree-tooltip-row">
            <span className={`tip-dot tip-${t.status}`} />
            <span className="tip-severity">{t.severity}</span>
            <span className="tip-title">{t.title}</span>
            {t.anchorState === "outdated" && <span className="outdated-tag">outdated</span>}
          </div>
        ))}
        {closed > 0 && <div className="tree-tooltip-more">+ {closed} closed</div>}
      </div>
    );
  }

  return (
    <>
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
    {renderTooltip()}
    </>
  );
}
