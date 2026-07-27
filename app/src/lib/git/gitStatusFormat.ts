import type { WorkingTreeDiffSource, WorkingTreeFileEntry } from "./types";

/** Diff pane subtitle for the active working-tree selection. */
export function formatWorkingTreeDiffSubtitle(
  source: WorkingTreeDiffSource,
  entry: WorkingTreeFileEntry | null,
): string {
  if (entry?.statusCode === "??") {
    return "Untracked file";
  }
  return source === "staged" ? "Staged changes" : "Unstaged changes (vs last commit)";
}

/** Optional help tooltip for the diff pane subtitle. */
export function formatWorkingTreeDiffSubtitleHelp(
  source: WorkingTreeDiffSource,
  entry: WorkingTreeFileEntry | null,
): string | undefined {
  if (entry?.statusCode === "??") {
    return undefined;
  }
  if (source === "unstaged") {
    return "Shows all working-tree changes compared to the last commit (HEAD), not the staging index. If you staged part of a file and edited it again, the diff includes both unstaged and previously staged edits.";
  }
  if (source === "staged") {
    return "Shows staged changes compared to the last commit (HEAD).";
  }
  return undefined;
}

/** Short label for a porcelain status code shown in the Changes panel. */
export function formatWorkingTreeStatusCode(statusCode: string): string {
  const trimmed = statusCode.trim();
  if (trimmed === "??") {
    return "Untracked";
  }
  // Any XY containing a `U` (or the symmetric `DD`/`AA`) is an unmerged
  // conflict; git never lets you "stage" one — you resolve and `git add` it.
  // Testing `U` before `M`/`A`/`D` matters: `UD`/`DU` would otherwise label
  // as "Deleted", `AU`/`UA`/`AA` as "Added", and `DD` as "Deleted" (M9).
  if (isConflictStatusCode(trimmed)) {
    return "Conflict";
  }
  if (trimmed.includes("M")) {
    return "Modified";
  }
  if (trimmed.includes("A")) {
    return "Added";
  }
  if (trimmed.includes("D")) {
    return "Deleted";
  }
  if (trimmed.includes("R")) {
    return "Renamed";
  }
  if (trimmed.includes("C")) {
    return "Copied";
  }
  return trimmed || "Changed";
}

/**
 * Whether a porcelain XY status code denotes an unmerged/conflict entry.
 * Covers every conflict code git emits in porcelain v1/v2 output:
 * `DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`. Exported so the changes-panel
 * split keeps conflicted paths out of the "Staged" list — git does not allow
 * staging a conflict, and previously a code like `DD` appeared in both lists,
 * letting a user "unstage" it with no warning (M9).
 */
export function isConflictStatusCode(statusCode: string): boolean {
  const trimmed = statusCode.trim();
  if (trimmed.length !== 2) {
    return false;
  }
  if (trimmed.includes("U")) {
    return true;
  }
  // `DD` (both sides deleted) and `AA` (both sides added) are conflicts that
  // do not contain a `U` character.
  return trimmed === "DD" || trimmed === "AA";
}
