import { logDiagnostic } from "../services/logging";
import {
  parseShortHeadRef,
  parseStatusPorcelain,
  parseStatusShortBranchHeader,
} from "./gitParse";
import { runGit, type GitCallScope } from "./gitService";
import { createGitCommandError } from "./types";
import type { AheadBehindCounts, CancellableGitOptions } from "./types";

export type RepositoryStatusSummary = {
  branchName: string;
  isDetached: boolean;
  aheadBehind: AheadBehindCounts | null;
  /** Set when upstream exists but ahead/behind query failed (non-upstream git error). */
  aheadBehindError?: string | null;
  isDirty: boolean;
  hasConflicts?: boolean;
  /**
   * True when the repository HEAD is unborn — `git init` ran but no commit
   * exists yet. Lets callers render their dedicated empty state instead of
   * surfacing a `git log` fatal.
   */
  isUnborn: boolean;
};

/**
 * Compact branch / tracking / working-tree summary for one repository root.
 *
 * Uses one `git status -sb` subprocess (plus `rev-parse --short HEAD` when detached)
 * instead of the prior 3–4 sequential calls (`branch`, upstream, porcelain, rev-list).
 */
export async function queryRepositoryStatusSummary(
  repoRoot: string,
  scope: GitCallScope = "background",
  options?: CancellableGitOptions,
): Promise<RepositoryStatusSummary> {
  const execute = (args: string[]) => options ? runGit(repoRoot, args, scope, undefined, options) : runGit(repoRoot, args, scope);
  const response = await execute(["status", "-sb"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  const headerLine = response.stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .find((line) => line.startsWith("## "));
  if (!headerLine) {
    throw createGitCommandError({
      ...response,
      exitCode: response.exitCode || 1,
      stderr: response.stderr || "Missing branch header in git status -sb output",
    });
  }

  const parsed = parseStatusShortBranchHeader(headerLine);
  if (!parsed) {
    throw createGitCommandError({
      ...response,
      exitCode: response.exitCode || 1,
      stderr: response.stderr || "Unparseable branch header in git status -sb output",
    });
  }

  let branchName = parsed.branchName;
  if (parsed.isDetached) {
    const headResponse = await execute(["rev-parse", "--short", "HEAD"]);
    if (headResponse.exitCode !== 0) {
      throw createGitCommandError(headResponse);
    }
    branchName = parseShortHeadRef(headResponse.stdout);
  }

  const porcelainStdout = response.stdout
    .split("\n")
    .filter((line) => !line.replace(/\r$/, "").startsWith("## "))
    .join("\n");
  const isDirty = parseStatusPorcelain(porcelainStdout).length > 0;
  const hasConflicts = porcelainStdout.split("\n").some(line => /^(DD|AU|UD|UA|DU|AA|UU) /.test(line));

  // An unborn HEAD (freshly init'd repo, no commits) has no upstream and no
  // ahead/behind to compute — and `parseStatusShortBranchHeader` already
  // reported `isUnborn` with `upstream: null`. Skip the gone/upstream branch
  // below rather than re-deriving it from the placeholder header text.
  if (parsed.isUnborn) {
    return {
      branchName,
      isDetached: false,
      aheadBehind: null,
      aheadBehindError: null,
      isDirty,
      hasConflicts,
      isUnborn: true,
    };
  }

  let aheadBehind = parsed.aheadBehind;
  let aheadBehindError: string | null = null;
  if (!parsed.isDetached && parsed.upstream && aheadBehind === null && !headerLine.includes("[gone]")) {
    aheadBehind = { ahead: 0, behind: 0 };
  }

  if (
    !parsed.isDetached &&
    parsed.upstream &&
    aheadBehind === null &&
    headerLine.includes("[gone]")
  ) {
    void logDiagnostic({
      level: "warn",
      source: "frontend",
      message: "Upstream branch is gone; omitting ahead/behind counts",
      timestamp: new Date().toISOString(),
      metadata: {
        repoRoot,
        upstream: parsed.upstream,
      },
    });
  }

  return {
    branchName,
    isDetached: parsed.isDetached,
    aheadBehind,
    aheadBehindError,
    isDirty,
    hasConflicts,
    isUnborn: false,
  };
}
