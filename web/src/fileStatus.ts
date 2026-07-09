import type { FileStatus } from "./types.js";

// VS Code-style status letters, shown as soft tinted chips in the file tree
// and the diff-stack file headers (full word kept as a title on hover).
export const FILE_STATUS_LETTER: Record<FileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  binary: "B",
};
