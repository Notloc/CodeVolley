import type { RevisionFile } from "./types.js";

export interface Section {
  name: string;
  pattern: string;
  priority: number;
}

export interface FileGroup {
  // null = the implicit group used when no sections are configured (rendered
  // without a header, preserving the original flat behaviour).
  name: string | null;
  files: RevisionFile[];
}

// Matches a file path against a section pattern. Patterns with no `*` are
// treated as a directory/exact prefix (so "src/db/" matches "src/db/foo.ts"
// but not "src/database.ts"); patterns with wildcards are globbed, where `**`
// spans path separators and `*` stays within a segment.
export function matchesPattern(filePath: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    if (filePath === pattern) return true;
    const prefix = pattern.endsWith("/") ? pattern : `${pattern}/`;
    return filePath.startsWith(prefix);
  }
  const regex = new RegExp(
    `^${pattern
      .split(/(\*\*|\*)/)
      .map((seg) => {
        if (seg === "**") return ".*";
        if (seg === "*") return "[^/]*";
        return seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("")}$`,
  );
  return regex.test(filePath);
}

// Groups files into ordered sections by priority (ascending: 1 first). Each
// file lands in the first matching section; unmatched files go to a trailing
// "Other" group. With no sections configured, returns a single unnamed group
// holding every file (i.e. the original flat tree).
export function groupFiles(files: RevisionFile[], sections: Section[]): FileGroup[] {
  if (sections.length === 0) return [{ name: null, files }];

  const ordered = [...sections].sort((a, b) => a.priority - b.priority);
  const buckets = new Map<string, RevisionFile[]>(ordered.map((s) => [s.name, []]));
  const other: RevisionFile[] = [];

  for (const file of files) {
    const section = ordered.find((s) => matchesPattern(file.path, s.pattern));
    if (section) buckets.get(section.name)!.push(file);
    else other.push(file);
  }

  const groups: FileGroup[] = [];
  for (const s of ordered) {
    const bucket = buckets.get(s.name)!;
    if (bucket.length > 0) groups.push({ name: s.name, files: bucket });
  }
  if (other.length > 0) groups.push({ name: "Other", files: other });
  return groups;
}
