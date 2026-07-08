import type { Anchor, Side } from "../shared/types.js";
import type { StoredRevision, StoredRevisionFile } from "./storage-types.js";

function sideContent(file: StoredRevisionFile, side: Side): string | null {
  return side === "NEW" ? file.newContent : file.oldContent;
}

// Locates an anchor's line within a target revision by exact line-content
// match, corroborated by whatever surrounding context is available
// (git-apply-style fuzz — design doc §3's re-anchoring behavioral
// contract). Falls back to matching the line's own content alone if the
// context match is ambiguous. Returns the new 1-indexed line, or null if no
// unambiguous match exists (caller marks the thread `outdated`).
//
// Known v1 limitation: looks up the target file by the *same path* as the
// anchor, so a thread anchored to a file that gets renamed in the new
// revision will go outdated even though the content still exists under its
// new name — rename-following re-anchoring isn't implemented.
export function findAnchorLine(
  sourceRevision: StoredRevision,
  targetRevision: StoredRevision,
  anchor: Pick<Anchor, "path" | "side" | "line">,
): number | null {
  const sourceFile = sourceRevision.files.find((f) => f.path === anchor.path);
  const targetFile = targetRevision.files.find((f) => f.path === anchor.path);
  if (!sourceFile || !targetFile) return null;

  const sourceContent = sideContent(sourceFile, anchor.side);
  const targetContent = sideContent(targetFile, anchor.side);
  if (sourceContent === null || targetContent === null) return null;

  const sourceLines = sourceContent.split("\n");
  const targetLines = targetContent.split("\n");
  const idx = anchor.line - 1;
  if (idx < 0 || idx >= sourceLines.length) return null;

  const thisLine = sourceLines[idx];
  const prevLine = idx > 0 ? sourceLines[idx - 1] : undefined;
  const nextLine = idx < sourceLines.length - 1 ? sourceLines[idx + 1] : undefined;

  const contextMatches: number[] = [];
  for (let i = 0; i < targetLines.length; i++) {
    if (targetLines[i] !== thisLine) continue;
    const prevOk = prevLine === undefined || (i > 0 && targetLines[i - 1] === prevLine);
    const nextOk = nextLine === undefined || (i < targetLines.length - 1 && targetLines[i + 1] === nextLine);
    if (prevOk && nextOk) contextMatches.push(i);
  }
  if (contextMatches.length === 1) return contextMatches[0] + 1;

  const lineMatches: number[] = [];
  for (let i = 0; i < targetLines.length; i++) {
    if (targetLines[i] === thisLine) lineMatches.push(i);
  }
  if (lineMatches.length === 1) return lineMatches[0] + 1;

  return null;
}
