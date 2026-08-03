import { logDiagnostic } from "../services/logging";
import {
  parseAheadBehindCount,
  parseBranchShowCurrent,
  parseBranchVvLines,
  parseShortHeadRef,
  parseUpstreamRef,
} from "./gitParse";
import { runGit } from "./gitRun";
import type { GitCallScope } from "./gitIntegrationGating";
import { assertGitCommandCompleted, GitRefValidationError } from "./gitErrors";
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
import { subscribeVersionControlMutations } from "./versionControlRefresh";

const NOT_A_REPOSITORY_EXIT_CODE = 128;

function isNotARepositoryResponse(response: RunGitResponse): boolean {
  if (response.exitCode === NOT_A_REPOSITORY_EXIT_CODE) {
    return true;
  }
  return response.stderr.toLowerCase().includes("not a git repository");
}

/**
 * P03-08-06 — memoized repository-root resolution.
 *
 * `git rev-parse --show-toplevel` was fired on every tab activation (the
 * project-tree badge effect) and twice per workspace-switch, doubling the
 * process count. The answer for a given workspace path only changes when the
 * path becomes (or stops being) a repository — i.e. on `git init`. Cache it
 * per workspace path for the process lifetime and invalidate on init-class
 * version-control mutations.
 */
const repoRootCache = new Map<string, ResolveRepoRootResult>();
let repoRootMutationHookInstalled = false;

function ensureRepoRootMutationHook(): void {
  if (repoRootMutationHookInstalled) {
    return;
  }
  repoRootMutationHookInstalled = true;
  // `git init` is surfaced as a "branch"-scope mutation by the VC view. A
  // workspace becoming a repo is the only transition that changes the cached
  // answer, so drop just that entry (other mutations leave the root unchanged).
  subscribeVersionControlMutations((workspaceRootPath, scope) => {
    if (scope === "branch") {
      repoRootCache.delete(workspaceRootPath);
    }
  });
}

/** Drop the cached repo-root result for one workspace (tests + explicit invalidation). */
export function invalidateResolveRepoRootCache(workspaceRootPath: string): void {
  repoRootCache.delete(workspaceRootPath);
}

/** Clear all cached repo-root results (tests only). */
export function resetResolveRepoRootCacheForTests(): void {
  repoRootCache.clear();
}

/**
 * Resolve the git repository root for a workspace path via
 * `git rev-parse --show-toplevel`. Memoized per workspace path.
 */
export async function resolveRepoRoot(
  workspaceRootPath: string,
  scope: GitCallScope = "background",
): Promise<ResolveRepoRootResult> {
  ensureRepoRootMutationHook();
  const cached = repoRootCache.get(workspaceRootPath);
  if (cached) {
    return cached;
  }

  const response = await runGit(workspaceRootPath, ["rev-parse", "--show-toplevel"], scope);

  if (isNotARepositoryResponse(response)) {
    const error: GitNotARepositoryError = createGitNotARepositoryError(
      workspaceRootPath,
      response.stderr,
    );
    const result: ResolveRepoRootResult = { ok: false, error };
    repoRootCache.set(workspaceRootPath, result);
    return result;
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
    const result: ResolveRepoRootResult = { ok: false, error };
    repoRootCache.set(workspaceRootPath, result);
    return result;
  }

  const result: ResolveRepoRootResult = { ok: true, repoRoot };
  repoRootCache.set(workspaceRootPath, result);
  return result;
}

/**
 * Query the current branch (or detached HEAD short SHA) and upstream tracking ref.
 */
export async function queryCurrentBranch(
  repoRoot: string,
  scope: GitCallScope = "background",
): Promise<CurrentBranchInfo> {
  const branchResponse = await runGit(repoRoot, ["branch", "--show-current"], scope);
  if (branchResponse.exitCode !== 0) {
    throw createGitCommandError(branchResponse);
  }

  const branchName = parseBranchShowCurrent(branchResponse.stdout);
  if (branchName === null) {
    const headResponse = await runGit(repoRoot, ["rev-parse", "--short", "HEAD"], scope);
    if (headResponse.exitCode !== 0) {
      throw createGitCommandError(headResponse);
    }

    return {
      name: parseShortHeadRef(headResponse.stdout),
      isDetached: true,
      upstream: null,
    };
  }

  const upstreamResponse = await runGit(
    repoRoot,
    ["rev-parse", "--abbrev-ref", "@{upstream}"],
    scope,
  );
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
export async function queryAheadBehind(
  repoRoot: string,
  scope: GitCallScope = "background",
): Promise<AheadBehindCounts | null> {
  const response = await runGit(
    repoRoot,
    ["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    scope,
  );
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
export async function queryBranches(
  repoRoot: string,
  scope: GitCallScope = "background",
): Promise<BranchSummary[]> {
  const response = await runGit(repoRoot, ["branch", "-vv"], scope);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseBranchVvLines(response.stdout);
}

/** Returns true when the repository has no working tree (`git rev-parse --is-bare-repository`). */
export async function queryIsBareRepository(
  repoRoot: string,
  scope: GitCallScope = "background",
): Promise<boolean> {
  const response = await runGit(repoRoot, ["rev-parse", "--is-bare-repository"], scope);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return response.stdout.trim().toLowerCase() === "true";
}

/** Switch to an existing local branch (`git checkout <name>`). */
export async function checkoutBranch(
  repoRoot: string,
  branchName: string,
  scope: GitCallScope = "versionControl",
): Promise<void> {
  const trimmed = branchName.trim();
  if (!trimmed) {
    throw new GitRefValidationError("Branch name cannot be empty.");
  }
  const validation = validateGitRefName(trimmed);
  if (!validation.ok) {
    throw new GitRefValidationError(validation.message);
  }

  // `--` disambiguates when a branch and a path share a name, otherwise git fails
  // with "ambiguous argument … could be both a local file and a tracking branch".
  const response = await runGit(repoRoot, ["checkout", trimmed, "--"], scope);
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Create a new branch from HEAD and check it out (`git checkout -b <name>`). */
export async function createBranch(
  repoRoot: string,
  name: string,
  scope: GitCallScope = "versionControl",
): Promise<void> {
  const validation = validateGitRefName(name);
  if (!validation.ok) {
    throw new GitRefValidationError(validation.message);
  }

  const response = await runGit(repoRoot, ["checkout", "-b", name.trim(), "--"], scope);
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}
