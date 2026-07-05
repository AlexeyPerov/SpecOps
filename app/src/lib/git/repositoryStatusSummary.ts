import { logDiagnostic } from "../services/logging";
import {
  parseShortHeadRef,
  parseStatusPorcelain,
  parseStatusShortBranchHeader,
} from "./gitParse";
import { runGit } from "./gitService";
import { createGitCommandError } from "./types";
import type { AheadBehindCounts } from "./types";

export type RepositoryStatusSummary = {
  branchName: string;
  isDetached: boolean;
  aheadBehind: AheadBehindCounts | null;
  /** Set when upstream exists but ahead/behind query failed (non-upstream git error). */
  aheadBehindError?: string | null;
  isDirty: boolean;
};

/**
 * Compact branch / tracking / working-tree summary for one repository root.
 *
 * Uses one `git status -sb` subprocess (plus `rev-parse --short HEAD` when detached)
 * instead of the prior 3–4 sequential calls (`branch`, upstream, porcelain, rev-list).
 */
export async function queryRepositoryStatusSummary(
  repoRoot: string,
): Promise<RepositoryStatusSummary> {
  const response = await runGit(repoRoot, ["status", "-sb"]);
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
    const headResponse = await runGit(repoRoot, ["rev-parse", "--short", "HEAD"]);
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
  };
}
