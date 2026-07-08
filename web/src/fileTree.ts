import type { RevisionFile } from "./types.js";

export interface TreeFileNode {
  type: "file";
  name: string; // basename
  file: RevisionFile;
}
export interface TreeDirNode {
  type: "dir";
  name: string; // possibly compressed, e.g. "com/company/app"
  path: string; // full path, stable key for collapse state
  children: TreeNode[];
}
export type TreeNode = TreeDirNode | TreeFileNode;

interface MutableDir {
  dirs: Map<string, MutableDir>;
  files: RevisionFile[];
}

// Builds a nested directory tree from a flat file list. Single-child directory
// chains are compressed onto one node (VS Code style), so deep paths like
// src/com/company/app/Foo.java don't become a staircase. Directories sort
// before files; both alphabetical.
export function buildFileTree(files: RevisionFile[]): TreeNode[] {
  const root: MutableDir = { dirs: new Map(), files: [] };

  for (const file of files) {
    const segments = file.path.split("/");
    segments.pop(); // drop the basename; the rest are directories
    let cur = root;
    for (const seg of segments) {
      let next = cur.dirs.get(seg);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        cur.dirs.set(seg, next);
      }
      cur = next;
    }
    cur.files.push(file);
  }

  return toNodes(root, "");
}

function toNodes(dir: MutableDir, prefix: string): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const name of [...dir.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
    let cur = dir.dirs.get(name)!;
    let dirName = name;
    let dirPath = prefix + name;
    // Compress: fold a chain of single-child directories into one node.
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [childName, childDir] = [...cur.dirs][0];
      dirName = `${dirName}/${childName}`;
      dirPath = `${dirPath}/${childName}`;
      cur = childDir;
    }
    nodes.push({ type: "dir", name: dirName, path: dirPath, children: toNodes(cur, `${dirPath}/`) });
  }

  for (const file of [...dir.files].sort((a, b) => a.path.localeCompare(b.path))) {
    nodes.push({ type: "file", name: file.path.slice(file.path.lastIndexOf("/") + 1), file });
  }

  return nodes;
}
