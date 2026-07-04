import { isWorkingTreeDirty, queryAheadBehind, queryCurrentBranch } from "./gitService";
import type { AheadBehindCounts } from "./types";

export type RepositoryStatusSummary = {
  branchName: string;
  isDetached: boolean;
  aheadBehind: AheadBehindCounts | null;
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
  if (!branch.isDetached && branch.upstream) {
    aheadBehind = await queryAheadBehind(repoRoot);
  }

  return {
    branchName: branch.name,
    isDetached: branch.isDetached,
    aheadBehind,
    isDirty,
  };
}
