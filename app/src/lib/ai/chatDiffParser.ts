import type {
  OpencodeFileChangeStatus,
  OpencodeSessionFileDiff,
} from "./backends/workspaceAgentBackend";

/**
 * M5-T2 — pure helpers for the session diff viewer.
 *
 * `session.diff` returns `SnapshotFileDiff[]` (file path, status, additions /
 * deletions counts, and a unified-diff `patch`). These helpers parse the
 * patch into renderable rows (added / removed / context / hunk-header), filter
 * the file list by status, and summarize totals. DOM-free + side-effect-free
 * so they're trivially unit-testable.
 */

export type DiffRowKind = "context" | "added" | "removed" | "hunk" | "meta";

export interface DiffRow {
  kind: DiffRowKind;
  /** Raw line text (without the leading `+`/`-`/` ` marker). */
  text: string;
  /** Old-file line number (null for added / hunk / meta). */
  oldLineNumber: number | null;
  /** New-file line number (null for removed / hunk / meta). */
  newLineNumber: number | null;
}

export interface ParsedFileDiff {
  file: OpencodeSessionFileDiff;
  rows: DiffRow[];
}

export type DiffStatusFilter = "all" | OpencodeFileChangeStatus;

/**
 * Parses a unified-diff `patch` into renderable rows. Tracks old/new line
 * numbers by walking the `@@ -a,b +c,d @@` hunk headers. Lines that aren't
 * part of a hunk (the `diff --git` / `index` / `+++` / `---` metadata and
 * the `\ No newline at end of file` marker) are emitted as `meta` rows so
 * the viewer can dim them. Returns an empty row list when the patch is empty
 * or binary.
 */
export function parseUnifiedDiffPatch(patch: string): DiffRow[] {
  if (!patch) {
    return [];
  }
  const lines = patch.split("\n");
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.length === 0 && !inHunk) {
      // Leading / trailing blank lines outside hunks are noise.
      continue;
    }
    if (line.startsWith("@@")) {
      const header = parseHunkHeader(line);
      if (header) {
        oldLine = header.oldStart;
        newLine = header.newStart;
        inHunk = true;
        rows.push({ kind: "hunk", text: line, oldLineNumber: null, newLineNumber: null });
        continue;
      }
    }
    if (!inHunk) {
      // `diff --git`, `index`, `+++ b/...`, `--- a/...`, `Binary files...`,
      // `\ No newline at end of file` (before the first hunk), etc.
      rows.push({ kind: "meta", text: line, oldLineNumber: null, newLineNumber: null });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({
        kind: "added",
        text: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      newLine += 1;
    } else if (line.startsWith("-")) {
      rows.push({
        kind: "removed",
        text: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine += 1;
    } else if (line.startsWith("\\")) {
      // `\ No newline at end of file` marker.
      rows.push({ kind: "meta", text: line, oldLineNumber: null, newLineNumber: null });
    } else {
      // Context line — may start with a space, or be a bare blank line that
      // is actually a context blank (treat as context once inside a hunk).
      const text = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({
        kind: "context",
        text,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine += 1;
      newLine += 1;
    }
  }
  return rows;
}

interface HunkHeader {
  oldStart: number;
  newStart: number;
}

/** Extracts the `oldStart` / `newStart` line numbers from `@@ -a,b +c,d @@`. */
export function parseHunkHeader(line: string): HunkHeader | null {
  const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
  if (!match) {
    return null;
  }
  return {
    oldStart: Number.parseInt(match[1]!, 10),
    newStart: Number.parseInt(match[2]!, 10),
  };
}

/** Parses every file's patch in one pass. */
export function parseSessionDiffs(files: readonly OpencodeSessionFileDiff[]): ParsedFileDiff[] {
  return files.map((file) => ({ file, rows: parseUnifiedDiffPatch(file.patch) }));
}

/** Filters the file list by status (`all` / `added` / `deleted` / `modified`). */
export function filterSessionDiffs(
  files: readonly OpencodeSessionFileDiff[],
  filter: DiffStatusFilter,
): OpencodeSessionFileDiff[] {
  if (filter === "all") {
    return [...files];
  }
  return files.filter((file) => file.status === filter);
}

export interface SessionDiffTotals {
  files: number;
  additions: number;
  deletions: number;
}

export function summarizeSessionDiffs(
  files: readonly OpencodeSessionFileDiff[],
): SessionDiffTotals {
  return files.reduce(
    (acc, file) => ({
      files: acc.files + 1,
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}

/** Short label for a status (used in the file list + filter chips). */
export function diffStatusBadgeLabel(status: OpencodeFileChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
  }
}

/**
 * Resolves a file's display basename + directory for the file list. Returns
 * the full path when there is no directory separator so callers can render
 * monospace paths consistently.
 */
export function splitDiffFilePath(filePath: string): { basename: string; directory: string } {
  const trimmed = filePath.trim();
  const index = Math.max(trimmed.lastIndexOf("/"), 0);
  return {
    basename: trimmed.slice(index).replace(/^\//, ""),
    directory: trimmed.slice(0, index),
  };
}
