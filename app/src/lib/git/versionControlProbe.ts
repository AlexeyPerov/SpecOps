import { checkGitAvailable, queryIsBareRepository, resolveRepoRoot, runGit, type GitCallScope } from "./gitService";
import { normalizeGitOutputPath, type RunGitResponse } from "./types";

export type VersionControlProbeResult =
  | { kind: "noWorkspace" }
  | { kind: "gitUnavailable"; error: string | null }
  | { kind: "notARepository"; workspaceRootPath: string }
  | { kind: "ready"; workspaceRootPath: string; repoRoot: string; isBareRepository: boolean };

const DEFAULT_LOCAL_GIT_USER_NAME = "SpecOps User";
const DEFAULT_LOCAL_GIT_USER_EMAIL = "specops@localhost";

async function readGitConfigValue(
  repoRoot: string,
  key: string,
  scope: GitCallScope = "versionControl",
): Promise<string | null> {
  const response = await runGit(repoRoot, ["config", "--get", key], scope);
  if (response.exitCode !== 0) {
    return null;
  }
  const trimmed = response.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function setLocalGitConfigValue(
  repoRoot: string,
  key: string,
  value: string,
  scope: GitCallScope = "versionControl",
): Promise<void> {
  const response = await runGit(repoRoot, ["config", key, value], scope);
  if (response.exitCode !== 0) {
    throw new Error(response.stderr.trim() || `Failed to set git config ${key}`);
  }
}

/** Ensure repo-local user.name and user.email exist so the first commit can succeed. */
export async function ensureLocalGitIdentityConfigured(
  repoRoot: string,
  scope: GitCallScope = "versionControl",
): Promise<void> {
  const userName = await readGitConfigValue(repoRoot, "user.name", scope);
  if (!userName) {
    await setLocalGitConfigValue(repoRoot, "user.name", DEFAULT_LOCAL_GIT_USER_NAME, scope);
  }

  const userEmail = await readGitConfigValue(repoRoot, "user.email", scope);
  if (!userEmail) {
    await setLocalGitConfigValue(repoRoot, "user.email", DEFAULT_LOCAL_GIT_USER_EMAIL, scope);
  }
}

/**
 * Probe git availability and repository root for the active workspace.
 * Used by the version-control view tab on mount and when the workspace changes.
 */
export async function probeVersionControlContext(
  workspaceRootPath: string | null,
  scope: GitCallScope = "versionControl",
): Promise<VersionControlProbeResult> {
  if (!workspaceRootPath) {
    return { kind: "noWorkspace" };
  }

  const gitAvailability = await checkGitAvailable();
  if (!gitAvailability.available) {
    return { kind: "gitUnavailable", error: gitAvailability.error };
  }

  const repoResult = await resolveRepoRoot(workspaceRootPath, scope);
  if (!repoResult.ok) {
    return { kind: "notARepository", workspaceRootPath };
  }

  const isBareRepository = await queryIsBareRepository(repoResult.repoRoot, scope);

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
  scope: GitCallScope = "versionControl",
): Promise<RunGitResponse> {
  const initResponse = await runGit(workspaceRootPath, ["init"], scope);
  if (initResponse.exitCode !== 0) {
    return initResponse;
  }

  const repoResult = await resolveRepoRoot(workspaceRootPath, scope);
  if (repoResult.ok) {
    await ensureLocalGitIdentityConfigured(repoResult.repoRoot, scope);
  }

  return initResponse;
}

export function workspaceUsesParentRepository(
  workspaceRootPath: string,
  repoRoot: string,
): boolean {
  const normalizedWorkspace = normalizeGitOutputPath(workspaceRootPath);
  const normalizedRepo = normalizeGitOutputPath(repoRoot);
  return normalizedWorkspace !== normalizedRepo;
}
