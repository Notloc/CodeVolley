import type { UnifiedRow } from "./diffRows.js";

export interface PatchParse {
  rows: UnifiedRow[];
  // rowIndex -> count of unchanged lines skipped immediately before that row.
  // Rendered as a non-expandable "N unchanged lines not shown" separator; the
  // bulk isn't stored for large files, so unlike the full-content diff these
  // gaps can't be dug into.
  gaps: Map<number, number>;
  // Last old/new line numbers reached — lets the caller render a trailing gap
  // down to the file's real end (known from oldLines/newLines).
  endOldLine: number;
  endNewLine: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// Parses a git unified diff (as stored for large files) into the same
// UnifiedRow shape the full-content path produces, so DiffFile can render and
// anchor threads against it identically. Real file line numbers come straight
// from the hunk headers, so anchors and file:line links stay accurate.
export function parsePatch(patch: string): PatchParse {
  const rows: UnifiedRow[] = [];
  const gaps = new Map<number, number>();
  let oldLine = 1;
  let newLine = 1;
  // Where the previous hunk left off on the old side, to size the gap before
  // the next one. Starts at 1 (top of file).
  let prevOldEnd = 1;
  // Only hunk bodies carry content rows. Outside a hunk we're in the file
  // preamble ("diff --git", "index", "--- a/…", "+++ b/…", rename/mode lines) —
  // crucially "---"/"+++" start with -/+ and must never be read as diff rows.
  let inHunk = false;

  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      const oldStart = Number(header[1]);
      const newStart = Number(header[3]);
      const skipped = oldStart - prevOldEnd;
      if (skipped > 0) gaps.set(rows.length, skipped);
      oldLine = oldStart;
      newLine = newStart;
      prevOldEnd = oldStart + Number(header[2] ?? "1");
      inHunk = true;
      continue;
    }
    if (line.startsWith("diff --git")) {
      inHunk = false;
      continue;
    }
    if (!inHunk) continue;
    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      rows.push({ oldLine: null, newLine: newLine++, text, kind: "added" });
    } else if (marker === "-") {
      rows.push({ oldLine: oldLine++, newLine: null, text, kind: "removed" });
    } else if (marker === " ") {
      rows.push({ oldLine: oldLine++, newLine: newLine++, text, kind: "unchanged" });
    }
    // Any other in-hunk line (only "\ No newline at end of file" in practice)
    // is ignored — it isn't a content row.
  }

  return { rows, gaps, endOldLine: oldLine, endNewLine: newLine };
}
