import { diffLines } from "diff";

export interface UnifiedRow {
  // For unchanged rows both numbers are set; a removed row has only oldLine,
  // an added row only newLine. The single `text` column is what makes this a
  // unified diff (one horizontal scrollbar for the whole file).
  oldLine: number | null;
  newLine: number | null;
  text: string;
  kind: "unchanged" | "added" | "removed";
}

function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // diffLines' value is \n-terminated per part
  return lines;
}

// Flattens jsdiff's parts into a unified list of rows: each hunk's removed
// lines are emitted (in order) followed by its added lines, matching the
// conventional unified-diff layout. No side-by-side pairing/alignment.
export function buildUnifiedRows(oldContent: string, newContent: string): UnifiedRow[] {
  const parts = diffLines(oldContent, newContent);
  const rows: UnifiedRow[] = [];
  let oldLineNo = 1;
  let newLineNo = 1;

  for (const part of parts) {
    const lines = linesOf(part.value);
    if (part.added) {
      for (const line of lines) rows.push({ oldLine: null, newLine: newLineNo++, text: line, kind: "added" });
    } else if (part.removed) {
      for (const line of lines) rows.push({ oldLine: oldLineNo++, newLine: null, text: line, kind: "removed" });
    } else {
      for (const line of lines) rows.push({ oldLine: oldLineNo++, newLine: newLineNo++, text: line, kind: "unchanged" });
    }
  }

  return rows;
}
