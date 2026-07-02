import { invoke } from "@tauri-apps/api/core";
import {
  createGitCommandError,
  createGitNotARepositoryError,
  normalizeGitOutputPath,
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
  const response = await invoke<RunGitResponse>("run_git", {
    repoRoot: workspaceRootPath,
    args: ["rev-parse", "--show-toplevel"],
  });

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
  createGitNotARepositoryError,
  isGitError,
  isGitNotARepositoryError,
  normalizeGitOutputPath,
} from "./types";
