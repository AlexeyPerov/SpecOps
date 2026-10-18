import type { WorkspaceGitSummarySnapshot } from "./workspaceGitSummary";
import { formatGitColumnDisplayText } from "./workspaceManagerGitColumn";

export function workspaceGitSummaryPresentation(cell: WorkspaceGitSummarySnapshot): { text: string; mark: string; detail: string } {
  const state = {
    unknown: "Git not checked", loading: "Checking Git…", fresh: "Fresh",
    stale: "Stale", notGit: "Not a Git repository", error: "Git error",
  }[cell.status];
  const marker = cell.status === "error" ? "!" : cell.refreshing || cell.status === "loading" ? "↻" : cell.status === "stale" ? "◷" : cell.status === "notGit" ? "—" : cell.status === "unknown" ? "?" : "";
  const summary = cell.summary;
  const content = summary ? formatGitColumnDisplayText(summary) : state;
  const mark = summary?.hasConflicts ? "⚠" : marker || (summary?.isDirty ? "●" : "✓");
  const text = summary ? `${content}${marker ? ` · ${marker} ${state === "Fresh" ? "Checking…" : state}` : ""}` : content;
  const details = summary ? [content, state] : [state];
  if (summary?.aheadBehindError) details.push(`Tracking unavailable: ${summary.aheadBehindError}`);
  else if (summary && !summary.aheadBehind) details.push("No upstream configured");
  if (summary?.hasConflicts) details.push("Working tree has merge conflicts");
  if (cell.refreshing) details.push("Checking Git; previous result retained");
  if (cell.error) details.push(cell.error);
  if (cell.checkedAt !== null) details.push(`Last successful check ${new Date(cell.checkedAt).toLocaleTimeString()}`);
  details.push("Ahead/behind uses locally known upstream refs; no fetch is performed.");
  return { text, mark, detail: details.join(" · ") };
}
