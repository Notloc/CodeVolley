import type { FileStatus } from "./types.js";

// Compact glyphs for the file-status badge (full word kept as a title on hover).
export const FILE_STATUS_SYMBOL: Record<FileStatus, string> = {
  added: "+",
  modified: "■",
  deleted: "−",
  renamed: "→",
  binary: "◆",
};
