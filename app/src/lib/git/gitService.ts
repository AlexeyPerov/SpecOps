import { invoke } from "@tauri-apps/api/core";
import {
  parseAheadBehindCount,
  parseBranchShowCurrent,
  parseShortHeadRef,
  parseUpstreamRef,
} from "./gitParse";
import {
  createGitCommandError,
  createGitNotARepositoryError,
  mapGitInvokeError,
  normalizeGitOutputPath,
  type AheadBehindCounts,
  type CurrentBranchInfo,
  type GitAvailableResponse,
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
 * Run `git` in `repoRoot` with argv passed directly (no shell interpolation).
 *
 * Tauri validation errors (empty or invalid `repoRoot`) are thrown as typed
 * {@link GitError} values.
 */
export async function runGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
): Promise<RunGitResponse> {
  try {
    return await invoke<RunGitResponse>("run_git", {
      repoRoot,
      args,
      ...(env ? { env } : {}),
    });
  } catch (error) {
    throw mapGitInvokeError(error, repoRoot);
  }
}

/** Probe whether system `git` is available on PATH. */
export async function checkGitAvailable(): Promise<GitAvailableResponse> {
  try {
    return await invoke<GitAvailableResponse>("git_available");
  } catch (error) {
    throw mapGitInvokeError(error, "");
  }
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

/**
 * Query ahead/behind counts against the current branch upstream.
 * Returns `null` when no upstream is configured.
 */
export async function queryAheadBehind(repoRoot: string): Promise<AheadBehindCounts | null> {
  const response = await runGit(repoRoot, [
    "rev-list",
    "--left-right",
    "--count",
    "@{u}...HEAD",
  ]);
  if (response.exitCode !== 0) {
    return null;
  }

  return parseAheadBehindCount(response.stdout);
}

export type {
  AheadBehindCounts,
  CurrentBranchInfo,
  GitAvailableResponse,
  GitError,
  RunGitResponse,
} from "./types";
export {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  isGitError,
  isGitNotARepositoryError,
  mapGitInvokeError,
  normalizeGitOutputPath,
} from "./types";
