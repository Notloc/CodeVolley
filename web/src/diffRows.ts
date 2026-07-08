import { diffLines } from "diff";

export interface DiffRow {
  oldLine: number | null;
  newLine: number | null;
  oldText: string | null;
  newText: string | null;
  kind: "unchanged" | "added" | "removed" | "modified";
}

function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // diffLines' value is \n-terminated per part
  return lines;
}

// Pairs jsdiff's flat added/removed/unchanged parts into side-by-side rows.
// Consecutive removed+added parts are zipped line-by-line into "modified"
// rows (padding the shorter side with a blank cell) — a reasonable
// approximation of a real side-by-side diff without a full alignment
// algorithm.
export function buildDiffRows(oldContent: string, newContent: string): DiffRow[] {
  const parts = diffLines(oldContent, newContent);
  const rows: DiffRow[] = [];
  let oldLineNo = 1;
  let newLineNo = 1;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      for (const line of linesOf(part.value)) {
        rows.push({ oldLine: oldLineNo++, newLine: newLineNo++, oldText: line, newText: line, kind: "unchanged" });
      }
      continue;
    }

    if (part.removed) {
      const removedLines = linesOf(part.value);
      const next = parts[i + 1];
      if (next?.added) {
        const addedLines = linesOf(next.value);
        const max = Math.max(removedLines.length, addedLines.length);
        for (let j = 0; j < max; j++) {
          const oldText = j < removedLines.length ? removedLines[j] : null;
          const newText = j < addedLines.length ? addedLines[j] : null;
          rows.push({
            oldLine: oldText !== null ? oldLineNo++ : null,
            newLine: newText !== null ? newLineNo++ : null,
            oldText,
            newText,
            kind: oldText !== null && newText !== null ? "modified" : oldText !== null ? "removed" : "added",
          });
        }
        i++; // consumed the paired 'added' part
      } else {
        for (const line of removedLines) {
          rows.push({ oldLine: oldLineNo++, newLine: null, oldText: line, newText: null, kind: "removed" });
        }
      }
      continue;
    }

    // Unpaired 'added' (no preceding 'removed' — pure insertion).
    for (const line of linesOf(part.value)) {
      rows.push({ oldLine: null, newLine: newLineNo++, oldText: null, newText: line, kind: "added" });
    }
  }

  return rows;
}
