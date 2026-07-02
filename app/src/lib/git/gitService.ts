import { invoke } from "@tauri-apps/api/core";
import {
  createGitCommandError,
  createGitNotARepositoryError,
  mapGitInvokeError,
  normalizeGitOutputPath,
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

export type { GitAvailableResponse, GitError, RunGitResponse } from "./types";
export {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  isGitError,
  isGitNotARepositoryError,
  mapGitInvokeError,
  normalizeGitOutputPath,
} from "./types";
