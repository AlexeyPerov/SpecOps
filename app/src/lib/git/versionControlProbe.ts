import { checkGitAvailable, queryIsBareRepository, resolveRepoRoot, runGit } from "./gitService";
import { normalizeGitOutputPath, type RunGitResponse } from "./types";

export type VersionControlProbeResult =
  | { kind: "noWorkspace" }
  | { kind: "gitUnavailable"; error: string | null }
  | { kind: "notARepository"; workspaceRootPath: string }
  | { kind: "ready"; workspaceRootPath: string; repoRoot: string; isBareRepository: boolean };

/**
 * Probe git availability and repository root for the active workspace.
 * Used by the version-control view tab on mount and when the workspace changes.
 */
export async function probeVersionControlContext(
  workspaceRootPath: string | null,
): Promise<VersionControlProbeResult> {
  if (!workspaceRootPath) {
    return { kind: "noWorkspace" };
  }

  const gitAvailability = await checkGitAvailable();
  if (!gitAvailability.available) {
    return { kind: "gitUnavailable", error: gitAvailability.error };
  }

  const repoResult = await resolveRepoRoot(workspaceRootPath);
  if (!repoResult.ok) {
    return { kind: "notARepository", workspaceRootPath };
  }

  const isBareRepository = await queryIsBareRepository(repoResult.repoRoot);

  return {
    kind: "ready",
    workspaceRootPath,
    repoRoot: repoResult.repoRoot,
    isBareRepository,
  };
}

/** Initialize a new git repository at the workspace root (`git init`). */
export async function initRepositoryAtWorkspaceRoot(
  workspaceRootPath: string,
): Promise<RunGitResponse> {
  return runGit(workspaceRootPath, ["init"]);
}

export function workspaceUsesParentRepository(
  workspaceRootPath: string,
  repoRoot: string,
): boolean {
  const normalizedWorkspace = normalizeGitOutputPath(workspaceRootPath);
  const normalizedRepo = normalizeGitOutputPath(repoRoot);
  return normalizedWorkspace !== normalizedRepo;
}
