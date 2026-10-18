import type { RepositoryStatusSummary } from "./repositoryStatusSummary";

export function formatGitColumnDisplayText(summary: RepositoryStatusSummary): string {
  const branchLabel = summary.isDetached ? `detached @ ${summary.branchName}` : summary.branchName;
  const parts: string[] = [branchLabel];

  if (summary.aheadBehind) {
    const trackingParts: string[] = [];
    if (summary.aheadBehind.ahead > 0) {
      trackingParts.push(`↑${summary.aheadBehind.ahead}`);
    }
    if (summary.aheadBehind.behind > 0) {
      trackingParts.push(`↓${summary.aheadBehind.behind}`);
    }
    if (trackingParts.length > 0) {
      parts.push(trackingParts.join(" "));
    }
  }

  parts.push(summary.hasConflicts ? "conflicts" : summary.isDirty ? "dirty" : "clean");
  return parts.join(" · ");
}
