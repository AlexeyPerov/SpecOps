import { logDiagnostic } from "../services/logging";
import { isWorkingTreeDirty, queryAheadBehind, queryCurrentBranch } from "./gitService";
import type { AheadBehindCounts } from "./types";

export type RepositoryStatusSummary = {
  branchName: string;
  isDetached: boolean;
  aheadBehind: AheadBehindCounts | null;
  /** Set when upstream exists but ahead/behind query failed (non-upstream git error). */
  aheadBehindError?: string | null;
  isDirty: boolean;
};

/** Compact branch / tracking / working-tree summary for one repository root. */
export async function queryRepositoryStatusSummary(
  repoRoot: string,
): Promise<RepositoryStatusSummary> {
  const [branch, isDirty] = await Promise.all([
    queryCurrentBranch(repoRoot),
    isWorkingTreeDirty(repoRoot),
  ]);

  let aheadBehind: AheadBehindCounts | null = null;
  let aheadBehindError: string | null = null;
  if (!branch.isDetached && branch.upstream) {
    try {
      aheadBehind = await queryAheadBehind(repoRoot);
    } catch (error) {
      aheadBehindError = error instanceof Error ? error.message : String(error);
      void logDiagnostic({
        level: "warn",
        source: "frontend",
        message: "Failed to query ahead/behind counts for workspace git column",
        timestamp: new Date().toISOString(),
        metadata: {
          repoRoot,
          error: aheadBehindError,
        },
      });
    }
  }

  return {
    branchName: branch.name,
    isDetached: branch.isDetached,
    aheadBehind,
    aheadBehindError,
    isDirty,
  };
}
