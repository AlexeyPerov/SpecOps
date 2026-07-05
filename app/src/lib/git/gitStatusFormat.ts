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
  if (trimmed.includes("U")) {
    return "Unmerged";
  }
  return trimmed || "Changed";
}
