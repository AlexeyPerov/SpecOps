import { invoke } from "@tauri-apps/api/core";
import { logDiagnostic } from "../services/logging";
import {
  parseAheadBehindCount,
  parseBranchShowCurrent,
  parseBranchVvLines,
  parseCommitShow,
  parseStatusPorcelain,
  splitWorkingTreeStatus,
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  parseLogCommits,
  parseShortHeadRef,
  parseTagList,
  parseUpstreamRef,
} from "./gitParse";
import { validateGitRefName } from "./gitRefName";
import {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  DEFAULT_COMMIT_LOG_LIMIT,
  isGitError,
  mapGitInvokeError,
  normalizeGitOutputPath,
  type AheadBehindCounts,
  type BranchSummary,
  type CommitDetail,
  type CommitSummary,
  type CurrentBranchInfo,
  type GitAvailableResponse,
  type GitNotARepositoryError,
  type QueryCommitsOptions,
  type ResolveRepoRootResult,
  type RunGitResponse,
  type WorkingTreeStatus,
} from "./types";

const NOT_A_REPOSITORY_EXIT_CODE = 128;

function logGitCommandSummary(
  repoRoot: string,
  args: string[],
  response: RunGitResponse,
): void {
  const command = `git ${args.join(" ")}`;
  void logDiagnostic({
    level: response.exitCode === 0 ? "info" : "warn",
    source: "frontend",
    message: `${command} → exit ${response.exitCode}`,
    timestamp: new Date().toISOString(),
    metadata: {
      command: args,
      exitCode: response.exitCode,
      durationMs: response.durationMs,
      repoRoot,
    },
  });
}

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
    const response = await invoke<RunGitResponse>("run_git", {
      repoRoot,
      args,
      ...(env ? { env } : {}),
    });
    logGitCommandSummary(repoRoot, args, response);
    return response;
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

/**
 * Query commit history for the current branch using structured `git log` output.
 * Returns commits newest-first (default `git log` order).
 */
export async function queryCommits(
  repoRoot: string,
  options: QueryCommitsOptions = {},
): Promise<CommitSummary[]> {
  const limit = options.limit ?? DEFAULT_COMMIT_LOG_LIMIT;
  const response = await runGit(repoRoot, [
    "log",
    "--no-show-signature",
    "--decorate=full",
    `--format=${GIT_LOG_FORMAT}`,
    `-${limit}`,
  ]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseLogCommits(response.stdout);
}

/**
 * Query full commit metadata and changed files for one revision.
 * Uses `git show --name-status --format=…` (no diff hunks).
 */
export async function queryCommitDetail(repoRoot: string, sha: string): Promise<CommitDetail> {
  const response = await runGit(repoRoot, [
    "show",
    "--name-status",
    `--format=${GIT_SHOW_FORMAT}`,
    sha,
  ]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  const detail = parseCommitShow(response.stdout);
  if (!detail) {
    throw createGitCommandError({
      ...response,
      exitCode: response.exitCode || 1,
      stderr: response.stderr || "Failed to parse commit detail output",
    });
  }

  return detail;
}

/**
 * Query local branches with current marker, upstream, and last-commit hint.
 */
export async function queryBranches(repoRoot: string): Promise<BranchSummary[]> {
  const response = await runGit(repoRoot, ["branch", "-vv"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseBranchVvLines(response.stdout);
}

/**
 * Query local tags via `git tag -l`.
 * Returns tag names sorted alphabetically.
 */
export async function queryTags(repoRoot: string): Promise<string[]> {
  const response = await runGit(repoRoot, ["tag", "-l"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseTagList(response.stdout);
}

/**
 * Query staged and unstaged working-tree files via `git status --porcelain`.
 */
export async function queryWorkingTreeStatus(repoRoot: string): Promise<WorkingTreeStatus> {
  const response = await runGit(repoRoot, ["status", "--porcelain"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return splitWorkingTreeStatus(parseStatusPorcelain(response.stdout));
}

/** Returns true when porcelain status has any entries (dirty working tree). */
export async function isWorkingTreeDirty(repoRoot: string): Promise<boolean> {
  const response = await runGit(repoRoot, ["status", "--porcelain"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseStatusPorcelain(response.stdout).length > 0;
}

/** Stage selected paths (`git add -- …`). */
export async function stagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const response = await runGit(repoRoot, ["add", "--", ...paths]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Stage all unstaged changes (`git add -A`). */
export async function stageAll(repoRoot: string): Promise<void> {
  const response = await runGit(repoRoot, ["add", "-A"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Unstage selected paths (`git restore --staged -- …`). */
export async function unstagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const response = await runGit(repoRoot, ["restore", "--staged", "--", ...paths]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

export class GitCommitValidationError extends Error {
  readonly kind = "commitValidation" as const;

  constructor(message: string) {
    super(message);
    this.name = "GitCommitValidationError";
  }
}

export class GitRefValidationError extends Error {
  readonly kind = "refValidation" as const;

  constructor(message: string) {
    super(message);
    this.name = "GitRefValidationError";
  }
}

/**
 * Create a commit with a message written to a secure temp file on the Rust side.
 * Message is trimmed; empty messages are rejected before invoking git.
 */
export async function createCommit(repoRoot: string, message: string): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new GitCommitValidationError("Commit message cannot be empty.");
  }

  try {
    const response = await invoke<RunGitResponse>("git_commit_with_message", {
      repoRoot,
      message: trimmed,
    });
    logGitCommandSummary(repoRoot, ["commit", "-F", "<message-file>"], response);
    if (response.exitCode !== 0) {
      throw createGitCommandError(response);
    }
  } catch (error) {
    if (error instanceof GitCommitValidationError || isGitError(error)) {
      throw error;
    }
    throw mapGitInvokeError(error, repoRoot);
  }
}

/** Switch to an existing local branch (`git checkout <name>`). */
export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  const response = await runGit(repoRoot, ["checkout", branchName]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Fetch from default remotes (`git fetch`). */
export async function fetchRemote(repoRoot: string): Promise<void> {
  const response = await runGit(repoRoot, ["fetch"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Pull from default upstream (`git pull`). */
export async function pullRemote(repoRoot: string): Promise<void> {
  const response = await runGit(repoRoot, ["pull"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

export class GitNoUpstreamError extends Error {
  readonly kind = "noUpstream" as const;
  readonly branchName: string | null;

  constructor(message: string, branchName: string | null = null) {
    super(message);
    this.name = "GitNoUpstreamError";
    this.branchName = branchName;
  }
}

function parseNoUpstreamBranch(stderr: string): string | null {
  const match = stderr.match(/branch (\S+) has no upstream branch/);
  return match?.[1] ?? null;
}

function isNoUpstreamPushError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes("no upstream branch") || lower.includes("set-upstream");
}

/** Push to default upstream (`git push`). */
export async function pushRemote(repoRoot: string): Promise<void> {
  const response = await runGit(repoRoot, ["push"]);
  if (response.exitCode !== 0) {
    if (isNoUpstreamPushError(response.stderr)) {
      const branchName = parseNoUpstreamBranch(response.stderr);
      throw new GitNoUpstreamError(
        branchName
          ? `Branch "${branchName}" has no upstream. Set an upstream branch before pushing.`
          : "Current branch has no upstream. Set an upstream branch before pushing.",
        branchName,
      );
    }
    throw createGitCommandError(response);
  }
}

/** Create a lightweight tag at HEAD (`git tag <name>`). */
export async function createTag(repoRoot: string, name: string): Promise<void> {
  const validation = validateGitRefName(name);
  if (!validation.ok) {
    throw new GitRefValidationError(validation.message);
  }

  const response = await runGit(repoRoot, ["tag", name.trim()]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Delete a local tag (`git tag -d <name>`). Does not delete remote tags. */
export async function deleteLocalTag(repoRoot: string, name: string): Promise<void> {
  const response = await runGit(repoRoot, ["tag", "-d", name]);
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

export type {
  AheadBehindCounts,
  BranchSummary,
  CommitDecorator,
  CommitDecoratorType,
  CommitDetail,
  CommitFileChange,
  CommitFileStatus,
  CommitSummary,
  CurrentBranchInfo,
  GitAvailableResponse,
  GitError,
  QueryCommitsOptions,
  RunGitResponse,
  WorkingTreeFileEntry,
  WorkingTreeStatus,
} from "./types";
export { DEFAULT_COMMIT_LOG_LIMIT } from "./types";
export { GIT_LOG_FORMAT, GIT_SHOW_FORMAT } from "./gitParse";
export {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  isGitError,
  isGitNotARepositoryError,
  mapGitInvokeError,
  normalizeGitOutputPath,
} from "./types";
