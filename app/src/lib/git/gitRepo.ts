import { logDiagnostic } from "../services/logging";
import {
  parseAheadBehindCount,
  parseBranchShowCurrent,
  parseBranchVvLines,
  parseShortHeadRef,
  parseUpstreamRef,
} from "./gitParse";
import { runGit } from "./gitRun";
import { GitRefValidationError } from "./gitErrors";
import { validateGitRefName } from "./gitRefName";
import {
  createGitCommandError,
  createGitNotARepositoryError,
  normalizeGitOutputPath,
  type AheadBehindCounts,
  type BranchSummary,
  type CurrentBranchInfo,
  type GitNotARepositoryError,
  type ResolveRepoRootResult,
  type RunGitResponse,
} from "./types";

const NOT_A_REPOSITORY_EXIT_CODE = 128;

function isNotARepositoryResponse(response: RunGitResponse): boolean {
  if (response.exitCode === NOT_A_REPOSITORY_EXIT_CODE) {
    return true;
  }
  return response.stderr.toLowerCase().includes("not a git repository");
}

/**
 * Resolve the git repository root for a workspace path via
 * `git rev-parse --show-toplevel`.
 */
export async function resolveRepoRoot(
  workspaceRootPath: string,
): Promise<ResolveRepoRootResult> {
  const response = await runGit(workspaceRootPath, ["rev-parse", "--show-toplevel"]);

  if (isNotARepositoryResponse(response)) {
    const error: GitNotARepositoryError = createGitNotARepositoryError(
      workspaceRootPath,
      response.stderr,
    );
    return { ok: false, error };
  }

  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  const repoRoot = normalizeGitOutputPath(response.stdout);
  if (!repoRoot) {
    const error: GitNotARepositoryError = createGitNotARepositoryError(
      workspaceRootPath,
      response.stderr,
    );
    return { ok: false, error };
  }

  return { ok: true, repoRoot };
}

/**
 * Query the current branch (or detached HEAD short SHA) and upstream tracking ref.
 */
export async function queryCurrentBranch(repoRoot: string): Promise<CurrentBranchInfo> {
  const branchResponse = await runGit(repoRoot, ["branch", "--show-current"]);
  if (branchResponse.exitCode !== 0) {
    throw createGitCommandError(branchResponse);
  }

  const branchName = parseBranchShowCurrent(branchResponse.stdout);
  if (branchName === null) {
    const headResponse = await runGit(repoRoot, ["rev-parse", "--short", "HEAD"]);
    if (headResponse.exitCode !== 0) {
      throw createGitCommandError(headResponse);
    }

    return {
      name: parseShortHeadRef(headResponse.stdout),
      isDetached: true,
      upstream: null,
    };
  }

  const upstreamResponse = await runGit(repoRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  const upstream =
    upstreamResponse.exitCode === 0 ? parseUpstreamRef(upstreamResponse.stdout) : null;

  return {
    name: branchName,
    isDetached: false,
    upstream,
  };
}

/** True when `rev-list @{u}...HEAD` failed because upstream is missing or unknown. */
export function isNoUpstreamAheadBehindError(response: RunGitResponse): boolean {
  if (response.exitCode === 0) {
    return false;
  }

  const stderr = response.stderr.toLowerCase();
  return (
    stderr.includes("no upstream configured") ||
    stderr.includes("unknown revision") ||
    stderr.includes("no merge base")
  );
}

/**
 * Query ahead/behind counts against the current branch upstream.
 * Returns `null` when no upstream is configured or stdout is unparseable.
 */
export async function queryAheadBehind(repoRoot: string): Promise<AheadBehindCounts | null> {
  const response = await runGit(repoRoot, [
    "rev-list",
    "--left-right",
    "--count",
    "@{u}...HEAD",
  ]);
  if (response.exitCode !== 0) {
    if (isNoUpstreamAheadBehindError(response)) {
      return null;
    }
    throw createGitCommandError(response);
  }

  const parsed = parseAheadBehindCount(response.stdout);
  if (parsed === null) {
    void logDiagnostic({
      level: "warn",
      source: "frontend",
      message: "Unparseable ahead/behind stdout from git rev-list",
      timestamp: new Date().toISOString(),
      metadata: {
        repoRoot,
        stdout: response.stdout,
      },
    });
  }
  return parsed;
}

/** Query local branches with current marker, upstream, and last-commit hint. */
export async function queryBranches(repoRoot: string): Promise<BranchSummary[]> {
  const response = await runGit(repoRoot, ["branch", "-vv"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseBranchVvLines(response.stdout);
}

/** Returns true when the repository has no working tree (`git rev-parse --is-bare-repository`). */
export async function queryIsBareRepository(repoRoot: string): Promise<boolean> {
  const response = await runGit(repoRoot, ["rev-parse", "--is-bare-repository"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return response.stdout.trim().toLowerCase() === "true";
}

/** Switch to an existing local branch (`git checkout -- <name>`). */
export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  const trimmed = branchName.trim();
  if (!trimmed) {
    throw new GitRefValidationError("Branch name cannot be empty.");
  }

  const response = await runGit(repoRoot, ["checkout", "--", trimmed]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Create a new branch from HEAD and check it out (`git checkout -b <name>`). */
export async function createBranch(repoRoot: string, name: string): Promise<void> {
  const validation = validateGitRefName(name);
  if (!validation.ok) {
    throw new GitRefValidationError(validation.message);
  }

  const response = await runGit(repoRoot, ["checkout", "-b", name.trim()]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}
