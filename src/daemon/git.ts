import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FileStatus } from "../shared/types.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

// Design doc §6: "Invalid committish → surface git's stderr." Callers catch
// this specifically and fold `.stderr` into the structured tool error.
export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new GitError(`git ${args.join(" ")} failed`, (e.stderr ?? e.message).trim());
  }
}

export async function resolveCommittish(repoRoot: string, committish: string): Promise<string> {
  return (await git(repoRoot, ["rev-parse", committish])).trim();
}

// Resolves to the repo root regardless of which subdirectory the daemon was
// launched from, mirroring how `git` itself walks up to find `.git`.
export async function getRepoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

export interface CapturedFile {
  path: string;
  status: FileStatus;
  oldPath?: string;
  oldContent: string | null;
  newContent: string | null;
}

function mapStatusCode(code: string): { status: FileStatus; renamed: boolean } {
  const letter = code[0];
  if (letter === "R" || letter === "C") return { status: "renamed", renamed: true };
  if (letter === "A") return { status: "added", renamed: false };
  if (letter === "D") return { status: "deleted", renamed: false };
  return { status: "modified", renamed: false };
}

interface NameStatusEntry {
  status: FileStatus;
  path: string;
  oldPath?: string;
}

function parseNameStatus(output: string): NameStatusEntry[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const fields = line.split("\t");
      const { status, renamed } = mapStatusCode(fields[0]);
      if (renamed) {
        return { status, oldPath: fields[1], path: fields[2] };
      }
      return { status, path: fields[1] };
    });
}

// `--numstat` marks a binary file's add/delete counts as "-" instead of a
// number. We only need that marker, not numstat's path field (whose rename
// format — "{old => new}" — is annoying to parse reliably) — `--name-status`
// and `--numstat` walk the same diff in the same order for identical args,
// so we zip the two outputs by position instead.
function parseBinaryFlags(output: string): boolean[] {
  return output
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t")[0] === "-");
}

async function showFile(repoRoot: string, rev: string, filePath: string): Promise<string> {
  return git(repoRoot, ["show", `${rev}:${filePath}`]);
}

async function readWorktreeFile(repoRoot: string, filePath: string): Promise<string> {
  return readFile(path.join(repoRoot, filePath), "utf8");
}

export interface CaptureResult {
  resolvedBase: string;
  resolvedHead: string;
  files: CapturedFile[];
}

// Design doc §2 capture semantics: `git diff <base> <head> -- <paths>` (or
// `git diff <base> -- <paths>` for the worktree head, which folds in
// uncommitted changes), storing full old+new content per changed file.
export async function captureDiff(
  repoRoot: string,
  base: string,
  head: string,
  paths: string[] = [],
): Promise<CaptureResult> {
  const resolvedBase = await resolveCommittish(repoRoot, base);
  const isWorktree = head === "WORKTREE";
  const resolvedHead = isWorktree ? "WORKTREE" : await resolveCommittish(repoRoot, head);

  const buildArgs = (formatFlags: string[]) => {
    const args = ["diff", "--find-renames", ...formatFlags, resolvedBase];
    if (!isWorktree) args.push(resolvedHead);
    if (paths.length > 0) args.push("--", ...paths);
    return args;
  };

  const [nameStatusOut, numstatOut] = await Promise.all([
    git(repoRoot, buildArgs(["--name-status"])),
    git(repoRoot, buildArgs(["--numstat"])),
  ]);

  const entries = parseNameStatus(nameStatusOut);
  const binaryFlags = parseBinaryFlags(numstatOut);

  const files = await Promise.all(
    entries.map(async (entry, i): Promise<CapturedFile> => {
      const isBinary = binaryFlags[i] ?? false;
      if (isBinary) {
        return { path: entry.path, status: "binary", oldPath: entry.oldPath, oldContent: null, newContent: null };
      }

      const oldSourcePath = entry.oldPath ?? entry.path;
      const [oldContent, newContent] = await Promise.all([
        entry.status === "added" ? Promise.resolve(null) : showFile(repoRoot, resolvedBase, oldSourcePath),
        entry.status === "deleted"
          ? Promise.resolve(null)
          : isWorktree
            ? readWorktreeFile(repoRoot, entry.path)
            : showFile(repoRoot, resolvedHead, entry.path),
      ]);

      return { path: entry.path, status: entry.status, oldPath: entry.oldPath, oldContent, newContent };
    }),
  );

  return { resolvedBase, resolvedHead, files };
}
