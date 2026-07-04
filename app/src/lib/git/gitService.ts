import { invoke } from "@tauri-apps/api/core";
import { logDiagnostic } from "../services/logging";
import { isWindows } from "../services/platform";
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
  parseRemoteVvLines,
  parseLsRemoteTags,
  parseUpstreamRef,
  parseStashList,
  GIT_STASH_LIST_FORMAT,
} from "./gitParse";
import { parseUnifiedDiff } from "./gitDiffParse";
import { validateGitRefName } from "./gitRefName";
import { enqueueGitCommandForRepo } from "./gitCommandQueue";
import { buildNonInteractiveRemoteEnv } from "./gitRemoteEnv";
import {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  DEFAULT_COMMIT_LOG_LIMIT,
  DEFAULT_HISTORY_FILTER_MODE,
  isGitError,
  mapGitInvokeError,
  normalizeGitOutputPath,
  type AheadBehindCounts,
  type BranchSummary,
  type CancelGitCommandResponse,
  type CancellableGitOptions,
  type CommitDetail,
  type CommitSummary,
  type CurrentBranchInfo,
  type GitAskpassOperation,
  type GitAvailableResponse,
  type GitNotARepositoryError,
  type GitRemote,
  type GitStashSummary,
  type GitTagSummary,
  type HistoryFilterMode,
  type ParsedTextDiff,
  type QueryCommitsOptions,
  type ResolveRepoRootResult,
  type RunGitResponse,
  type WorkingTreeDiffSource,
  type WorkingTreeStatus,
} from "./types";

/** Default ceiling for remote git network operations (10 minutes). */
export const REMOTE_GIT_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;

const NOT_A_REPOSITORY_EXIT_CODE = 128;

/** Context lines for `git diff` / `git show --patch` (D-02). */
export const DIFF_CONTEXT_LINES = 3;

/**
 * Maximum `git diff` / `git show --patch` stdout length parsed in the UI
 * (512 KiB). Larger patches throw {@link GitDiffTooLargeError} instead of
 * blocking the renderer.
 */
export const COMMIT_FILE_DIFF_MAX_BYTES = 512 * 1024;

function logGitCommandSummary(
  repoRoot: string,
  args: string[],
  response: RunGitResponse,
): void {
  const command = `git ${args.join(" ")}`;
  const stderr = response.stderr.trim();
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
      ...(response.exitCode !== 0 && stderr ? { stderr } : {}),
    },
  });
}

function isNotARepositoryResponse(response: RunGitResponse): boolean {
  if (response.exitCode === NOT_A_REPOSITORY_EXIT_CODE) {
    return true;
  }
  return response.stderr.toLowerCase().includes("not a git repository");
}

async function invokeRunGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  try {
    const response = await invoke<RunGitResponse>("run_git", {
      repoRoot,
      args,
      ...(env ? { env } : {}),
      ...(options?.commandId ? { commandId: options.commandId } : {}),
      ...(options?.askpass ? { askpassEnabled: true } : {}),
      ...(options?.askpassOperation ? { askpassOperation: options.askpassOperation } : {}),
      ...(options?.askpassTimeoutMs ? { askpassTimeoutMs: options.askpassTimeoutMs } : {}),
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
    logGitCommandSummary(repoRoot, args, response);
    return response;
  } catch (error) {
    throw mapGitInvokeError(error, repoRoot);
  }
}

/**
 * Run `git` in `repoRoot` with argv passed directly (no shell interpolation).
 *
 * Commands for the same repository root are serialized via {@link enqueueGitCommandForRepo};
 * unrelated repositories may run concurrently.
 *
 * Tauri validation errors (empty or invalid `repoRoot`) are thrown as typed
 * {@link GitError} values.
 */
export async function runGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  return enqueueGitCommandForRepo(repoRoot, () =>
    invokeRunGit(repoRoot, args, env, options),
  );
}

interface RemoteGitInvokeOptions extends CancellableGitOptions {
  operation: GitAskpassOperation;
}

async function runRemoteGit(
  repoRoot: string,
  args: string[],
  options?: RemoteGitInvokeOptions,
): Promise<RunGitResponse> {
  const env = buildNonInteractiveRemoteEnv();
  return runGit(repoRoot, args, env, {
    ...options,
    askpass: true,
    askpassOperation: options?.operation,
    timeoutMs: options?.timeoutMs ?? REMOTE_GIT_OPERATION_TIMEOUT_MS,
  });
}

/** Terminate an in-flight cancellable git command by id. */
export async function cancelGitCommand(commandId: string): Promise<CancelGitCommandResponse> {
  try {
    return await invoke<CancelGitCommandResponse>("cancel_git_command", { commandId });
  } catch (error) {
    throw mapGitInvokeError(error, "");
  }
}

const GIT_AVAILABILITY_TTL_MS = 60_000;

let cachedGitAvailability: GitAvailableResponse | null = null;
let gitAvailabilityExpiresAt = 0;
let gitAvailabilityProbe: Promise<GitAvailableResponse> | null = null;

/** Clear cached git availability probe results (tests only). */
export function resetGitAvailabilityCacheForTests(): void {
  cachedGitAvailability = null;
  gitAvailabilityExpiresAt = 0;
  gitAvailabilityProbe = null;
}

async function probeGitAvailable(): Promise<GitAvailableResponse> {
  try {
    const response = await invoke<GitAvailableResponse>("git_available");
    if (response.available) {
      cachedGitAvailability = response;
      gitAvailabilityExpiresAt = Date.now() + GIT_AVAILABILITY_TTL_MS;
    } else {
      resetGitAvailabilityCacheForTests();
    }
    return response;
  } catch (error) {
    resetGitAvailabilityCacheForTests();
    throw mapGitInvokeError(error, "");
  }
}

/** Probe whether system `git` is available on PATH (cached for 60s per session). */
export async function checkGitAvailable(): Promise<GitAvailableResponse> {
  const now = Date.now();
  if (cachedGitAvailability && now < gitAvailabilityExpiresAt) {
    return cachedGitAvailability;
  }

  if (gitAvailabilityProbe) {
    return gitAvailabilityProbe;
  }

  gitAvailabilityProbe = probeGitAvailable();
  try {
    return await gitAvailabilityProbe;
  } finally {
    gitAvailabilityProbe = null;
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
 * Throws {@link GitCommandError} for other git failures (lock conflicts, etc.).
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

/**
 * Build argv for `git log` commit history queries.
 * Scope flags follow reference behavior: local branches only, or branches plus remotes.
 */
export function buildQueryCommitsArgs(options: QueryCommitsOptions = {}): string[] {
  const limit = options.limit ?? DEFAULT_COMMIT_LOG_LIMIT;
  const filterMode = options.filterMode ?? DEFAULT_HISTORY_FILTER_MODE;

  const args = [
    "log",
    "--no-show-signature",
    "--decorate=full",
    `--format=${GIT_LOG_FORMAT}`,
  ];

  switch (filterMode) {
    case "all-branches":
      args.push("--branches");
      break;
    case "all-branches-and-remotes":
      args.push("--branches", "--remotes");
      break;
    case "current-branch":
      break;
  }

  args.push(`-${limit}`);
  return args;
}

/**
 * Query commit history using structured `git log` output.
 * Returns commits newest-first (default `git log` order).
 */
export async function queryCommits(
  repoRoot: string,
  options: QueryCommitsOptions = {},
): Promise<CommitSummary[]> {
  const response = await runGit(repoRoot, buildQueryCommitsArgs(options));
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

export class GitCommitFileDiffNotFoundError extends Error {
  readonly kind = "commitFileDiffNotFound" as const;
  readonly path: string;

  constructor(path: string) {
    super(`No diff found for path "${path}" in commit patch output.`);
    this.name = "GitCommitFileDiffNotFoundError";
    this.path = path;
  }
}

export class GitDiffTooLargeError extends Error {
  readonly kind = "diffTooLarge" as const;
  readonly path: string;
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(path: string, byteLength: number, maxBytes: number) {
    super(
      `Diff for "${path}" is too large to display (${byteLength} bytes; limit ${maxBytes}).`,
    );
    this.name = "GitDiffTooLargeError";
    this.path = path;
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

function findParsedTextDiff(
  parsed: ReturnType<typeof parseUnifiedDiff>,
  path: string,
): ReturnType<typeof parseUnifiedDiff>[number] | undefined {
  const normalizedPath = normalizeGitOutputPath(path);
  return parsed.find(
    (diff) => diff.path === normalizedPath || diff.oldPath === normalizedPath,
  );
}

/**
 * Fetch and parse a single file's patch diff for a commit.
 *
 * Normal commits use `git diff <parent>..<sha> -- <path>`. Root commits (no
 * `parentSha`) use `git show <sha> -- <path>`. Renamed files (`R` in
 * `queryCommitDetail`) may be requested by either the new path (`path`) or
 * the previous path (`oldPath` in the parsed diff).
 */
export async function queryCommitFileDiff(
  repoRoot: string,
  sha: string,
  path: string,
  parentSha?: string,
): Promise<ParsedTextDiff> {
  const normalizedPath = normalizeGitOutputPath(path);
  const args =
    parentSha !== undefined
      ? [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--patch",
          `--unified=${DIFF_CONTEXT_LINES}`,
          `${parentSha}..${sha}`,
          "--",
          normalizedPath,
        ]
      : [
          "show",
          "--no-color",
          "--patch",
          `--unified=${DIFF_CONTEXT_LINES}`,
          sha,
          "--",
          normalizedPath,
        ];

  const response = await runGit(repoRoot, args);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  const stdoutByteLength = new TextEncoder().encode(response.stdout).length;
  if (stdoutByteLength > COMMIT_FILE_DIFF_MAX_BYTES) {
    throw new GitDiffTooLargeError(normalizedPath, stdoutByteLength, COMMIT_FILE_DIFF_MAX_BYTES);
  }

  const parsed = parseUnifiedDiff(response.stdout);
  const match = findParsedTextDiff(parsed, normalizedPath);
  if (!match) {
    throw new GitCommitFileDiffNotFoundError(normalizedPath);
  }

  return match;
}

function gitNullDevicePath(): string {
  return isWindows() ? "NUL" : "/dev/null";
}

function isDiffCommandSuccess(response: RunGitResponse, allowExitOne: boolean): boolean {
  if (response.exitCode === 0) {
    return true;
  }
  return allowExitOne && response.exitCode === 1 && response.stdout.trim().length > 0;
}

function assertDiffCommandSuccess(response: RunGitResponse, allowExitOne: boolean): void {
  if (!isDiffCommandSuccess(response, allowExitOne)) {
    throw createGitCommandError(response);
  }
}

function parseWorkingTreeFileDiffPatch(
  stdout: string,
  normalizedPath: string,
): ParsedTextDiff {
  const stdoutByteLength = new TextEncoder().encode(stdout).length;
  if (stdoutByteLength > COMMIT_FILE_DIFF_MAX_BYTES) {
    throw new GitDiffTooLargeError(normalizedPath, stdoutByteLength, COMMIT_FILE_DIFF_MAX_BYTES);
  }

  const parsed = parseUnifiedDiff(stdout);
  const match = findParsedTextDiff(parsed, normalizedPath);
  if (!match) {
    throw new GitCommitFileDiffNotFoundError(normalizedPath);
  }

  return match;
}

/**
 * Fetch and parse a single working-tree file diff.
 *
 * **Staged** (`git diff --cached`): compares the index to `HEAD` — only hunks
 * already staged for commit.
 *
 * **Unstaged** (`git diff HEAD`): compares the working tree to `HEAD` — all
 * local changes for the path since the last commit (staged and unstaged deltas
 * combined). This is a simplified model versus `git diff` (working tree vs
 * index). Untracked paths fall back to `git diff --no-index` against the
 * platform null device when `git diff HEAD` produces no patch.
 */
export async function queryWorkingTreeFileDiff(
  repoRoot: string,
  path: string,
  source: WorkingTreeDiffSource,
): Promise<ParsedTextDiff> {
  const normalizedPath = normalizeGitOutputPath(path);

  if (source === "staged") {
    const response = await runGit(repoRoot, [
      "diff",
      "--no-color",
      "--patch",
      `--unified=${DIFF_CONTEXT_LINES}`,
      "--cached",
      "--",
      normalizedPath,
    ]);
    assertDiffCommandSuccess(response, false);
    return parseWorkingTreeFileDiffPatch(response.stdout, normalizedPath);
  }

  const headResponse = await runGit(repoRoot, [
    "diff",
    "--no-color",
    "--patch",
    `--unified=${DIFF_CONTEXT_LINES}`,
    "HEAD",
    "--",
    normalizedPath,
  ]);
  assertDiffCommandSuccess(headResponse, false);

  if (headResponse.stdout.trim().length > 0) {
    return parseWorkingTreeFileDiffPatch(headResponse.stdout, normalizedPath);
  }

  const untrackedResponse = await runGit(repoRoot, [
    "diff",
    "--no-index",
    "--no-color",
    "--patch",
    `--unified=${DIFF_CONTEXT_LINES}`,
    "--",
    gitNullDevicePath(),
    normalizedPath,
  ]);
  assertDiffCommandSuccess(untrackedResponse, true);

  if (!untrackedResponse.stdout.trim()) {
    throw new GitCommitFileDiffNotFoundError(normalizedPath);
  }

  return parseWorkingTreeFileDiffPatch(untrackedResponse.stdout, normalizedPath);
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
 * List configured remotes via `git remote -v`.
 * Returns remotes sorted by name; empty when none are configured.
 */
export async function queryRemotes(repoRoot: string): Promise<GitRemote[]> {
  const response = await runGit(repoRoot, ["remote", "-v"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseRemoteVvLines(response.stdout);
}

/**
 * List tag names on a remote via `git ls-remote --tags <remote>`.
 * Dedupes peeled `^{}` object lines.
 */
export async function queryRemoteTags(
  repoRoot: string,
  remoteName: string,
  options?: CancellableGitOptions,
): Promise<string[]> {
  const trimmedRemote = remoteName.trim();
  if (!trimmedRemote) {
    throw new GitRefValidationError("Remote name cannot be empty.");
  }

  const response = await runRemoteGit(
    repoRoot,
    ["ls-remote", "--tags", trimmedRemote],
    { ...options, operation: "lsRemote" },
  );
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseLsRemoteTags(response.stdout);
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

/** Returns true when the repository has no working tree (`git rev-parse --is-bare-repository`). */
export async function queryIsBareRepository(repoRoot: string): Promise<boolean> {
  const response = await runGit(repoRoot, ["rev-parse", "--is-bare-repository"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return response.stdout.trim().toLowerCase() === "true";
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
export async function createCommit(
  repoRoot: string,
  message: string,
  options?: CancellableGitOptions,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new GitCommitValidationError("Commit message cannot be empty.");
  }

  return enqueueGitCommandForRepo(repoRoot, async () => {
    try {
      const response = await invoke<RunGitResponse>("git_commit_with_message", {
        repoRoot,
        message: trimmed,
        ...(options?.commandId ? { commandId: options.commandId } : {}),
      });
      logGitCommandSummary(repoRoot, ["commit", "-F", "<message-file>"], response);
      assertGitCommandCompleted(response);
      if (response.exitCode !== 0) {
        throw createGitCommandError(response);
      }
    } catch (error) {
      if (
        error instanceof GitCommitValidationError ||
        isGitCommandCancelledError(error) ||
        isGitCommandTimedOutError(error) ||
        isGitError(error)
      ) {
        throw error;
      }
      throw mapGitInvokeError(error, repoRoot);
    }
  });
}

/** Switch to an existing local branch (`git checkout <name>`). */
export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  const response = await runGit(repoRoot, ["checkout", branchName]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Optional explicit remote/branch target for fetch, pull, or push. */
export interface RemoteOperationTarget {
  remoteName: string;
  branchName?: string | null;
}

function buildFetchArgs(target?: RemoteOperationTarget): string[] {
  if (!target?.remoteName?.trim()) {
    return ["fetch"];
  }
  return ["fetch", target.remoteName.trim()];
}

function buildPullArgs(target?: RemoteOperationTarget): string[] {
  if (!target?.remoteName?.trim()) {
    return ["pull"];
  }
  const remoteName = target.remoteName.trim();
  const branchName = target.branchName?.trim();
  return branchName ? ["pull", remoteName, branchName] : ["pull", remoteName];
}

function buildPushArgs(target?: RemoteOperationTarget): string[] {
  if (!target?.remoteName?.trim()) {
    return ["push"];
  }
  const remoteName = target.remoteName.trim();
  const branchName = target.branchName?.trim();
  return branchName ? ["push", remoteName, branchName] : ["push", remoteName, "HEAD"];
}

/** Fetch from all remotes, or a single remote when `target` is set. */
export async function fetchRemote(
  repoRoot: string,
  target?: RemoteOperationTarget,
  options?: CancellableGitOptions,
): Promise<void> {
  const response = await runRemoteGit(repoRoot, buildFetchArgs(target), {
    ...options,
    operation: "fetch",
  });
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Pull from upstream, or from an explicit remote (and optional branch). */
export async function pullRemote(
  repoRoot: string,
  target?: RemoteOperationTarget,
  options?: CancellableGitOptions,
): Promise<void> {
  const response = await runRemoteGit(repoRoot, buildPullArgs(target), {
    ...options,
    operation: "pull",
  });
  assertGitCommandCompleted(response);
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

export class GitCommandCancelledError extends Error {
  readonly kind = "cancelled" as const;

  constructor(message = "Git command was cancelled.") {
    super(message);
    this.name = "GitCommandCancelledError";
  }
}

export class GitCommandTimedOutError extends Error {
  readonly kind = "timedOut" as const;

  constructor(message = "Git command timed out.") {
    super(message);
    this.name = "GitCommandTimedOutError";
  }
}

export function isGitCommandCancelledError(error: unknown): error is GitCommandCancelledError {
  return error instanceof GitCommandCancelledError;
}

export function isGitCommandTimedOutError(error: unknown): error is GitCommandTimedOutError {
  return error instanceof GitCommandTimedOutError;
}

function assertGitCommandNotCancelled(response: RunGitResponse): void {
  if (response.cancelled) {
    throw new GitCommandCancelledError();
  }
}

function assertGitCommandNotTimedOut(response: RunGitResponse): void {
  if (response.timedOut) {
    throw new GitCommandTimedOutError();
  }
}

function assertGitCommandCompleted(response: RunGitResponse): void {
  assertGitCommandNotCancelled(response);
  assertGitCommandNotTimedOut(response);
}

function parseNoUpstreamBranch(stderr: string): string | null {
  const match = stderr.match(/branch (\S+) has no upstream branch/);
  return match?.[1] ?? null;
}

function isNoUpstreamPushError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes("no upstream branch") || lower.includes("set-upstream");
}

/** Push to upstream, or to an explicit remote (and optional branch). */
export async function pushRemote(
  repoRoot: string,
  target?: RemoteOperationTarget,
  options?: CancellableGitOptions,
): Promise<void> {
  const response = await runRemoteGit(repoRoot, buildPushArgs(target), {
    ...options,
    operation: "push",
  });
  assertGitCommandCompleted(response);
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

function validateRemoteName(remoteName: string): void {
  const trimmed = remoteName.trim();
  if (!trimmed) {
    throw new GitRefValidationError("Remote name cannot be empty.");
  }
}

/**
 * Push a single local tag to a remote (`git push <remote> refs/tags/<name>`).
 * Does not use `--tags` or `--delete`.
 */
export async function pushTag(
  repoRoot: string,
  remoteName: string,
  tagName: string,
  options?: CancellableGitOptions,
): Promise<void> {
  validateRemoteName(remoteName);

  const validation = validateGitRefName(tagName);
  if (!validation.ok) {
    throw new GitRefValidationError(validation.message);
  }

  const trimmedTag = tagName.trim();
  const response = await runRemoteGit(
    repoRoot,
    ["push", remoteName.trim(), `refs/tags/${trimmedTag}`],
    { ...options, operation: "tagPush" },
  );
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/**
 * Delete a tag on a remote via `git push --delete <remote> refs/tags/<name>`.
 */
export async function deleteRemoteTag(
  repoRoot: string,
  remoteName: string,
  tagName: string,
  options?: CancellableGitOptions,
): Promise<void> {
  validateRemoteName(remoteName);

  const validation = validateGitRefName(tagName);
  if (!validation.ok) {
    throw new GitRefValidationError(validation.message);
  }

  const trimmedTag = tagName.trim();
  const response = await runRemoteGit(
    repoRoot,
    ["push", "--delete", remoteName.trim(), `refs/tags/${trimmedTag}`],
    { ...options, operation: "tagDelete" },
  );
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

export class GitTagPartialDeleteError extends Error {
  readonly kind = "tagPartialDelete" as const;
  readonly failedRemotes: Array<{ remoteName: string; message: string }>;

  constructor(failedRemotes: Array<{ remoteName: string; message: string }>) {
    const names = failedRemotes.map((entry) => entry.remoteName).join(", ");
    super(`Tag deleted locally, but remote delete failed on: ${names}`);
    this.name = "GitTagPartialDeleteError";
    this.failedRemotes = failedRemotes;
  }
}

export interface DeleteTagOptions extends CancellableGitOptions {
  /** When provided, delete the tag on each remote after local delete. */
  remoteNames?: string[];
}

/**
 * Delete a tag locally, optionally followed by remote deletes.
 * When remote deletes fail after local success, throws {@link GitTagPartialDeleteError}.
 */
export async function deleteTag(
  repoRoot: string,
  tagName: string,
  options?: DeleteTagOptions,
): Promise<void> {
  await deleteLocalTag(repoRoot, tagName);

  const remoteNames = options?.remoteNames?.map((name) => name.trim()).filter(Boolean) ?? [];
  if (remoteNames.length === 0) {
    return;
  }

  const failedRemotes: Array<{ remoteName: string; message: string }> = [];
  for (const remoteName of remoteNames) {
    try {
      await deleteRemoteTag(repoRoot, remoteName, tagName, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedRemotes.push({ remoteName, message });
    }
  }

  if (failedRemotes.length > 0) {
    throw new GitTagPartialDeleteError(failedRemotes);
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

export class GitStashNothingToSaveError extends Error {
  readonly kind = "stashNothingToSave" as const;

  constructor(message = "No local changes to save.") {
    super(message);
    this.name = "GitStashNothingToSaveError";
  }
}

export class GitStashNotFoundError extends Error {
  readonly kind = "stashNotFound" as const;
  readonly stashRef: string;

  constructor(stashRef: string, message?: string) {
    super(message ?? `Stash "${stashRef}" was not found.`);
    this.name = "GitStashNotFoundError";
    this.stashRef = stashRef;
  }
}

export class GitStashApplyConflictError extends Error {
  readonly kind = "stashApplyConflict" as const;
  readonly stashRef: string;
  readonly stderr: string;

  constructor(stashRef: string, stderr: string) {
    super(`Could not apply stash "${stashRef}" because of conflicts.`);
    this.name = "GitStashApplyConflictError";
    this.stashRef = stashRef;
    this.stderr = stderr;
  }
}

function isStashNothingToSaveResponse(response: RunGitResponse): boolean {
  const lower = response.stderr.toLowerCase();
  return lower.includes("no local changes to save");
}

function isStashNotFoundResponse(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("is not a valid stash") ||
    lower.includes("log for 'stash' only has") ||
    lower.includes("unknown stash")
  );
}

function isStashApplyConflictResponse(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("could not apply") ||
    lower.includes("merge conflict") ||
    lower.includes("overwritten by merge") ||
    lower.includes("conflict in") ||
    lower.includes("unmerged files")
  );
}

/**
 * Stash working-tree changes (`git stash push`).
 * When nothing changed, throws {@link GitStashNothingToSaveError}.
 */
export async function createStash(
  repoRoot: string,
  message?: string,
  includeUntracked = true,
): Promise<void> {
  const args = ["stash", "push"];
  if (includeUntracked) {
    args.push("--include-untracked");
  }
  const trimmedMessage = message?.trim();
  if (trimmedMessage) {
    args.push("-m", trimmedMessage);
  }

  const response = await runGit(repoRoot, args);
  if (response.exitCode !== 0) {
    if (isStashNothingToSaveResponse(response)) {
      throw new GitStashNothingToSaveError();
    }
    throw createGitCommandError(response);
  }
}

/** List stashes via structured `git stash list -z --format=…` (newest first). */
export async function queryStashes(repoRoot: string): Promise<GitStashSummary[]> {
  const response = await runGit(repoRoot, [
    "stash",
    "list",
    "-z",
    "--no-show-signature",
    `--format=${GIT_STASH_LIST_FORMAT}`,
  ]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseStashList(response.stdout);
}

/**
 * Apply or pop a stash ref (`git stash apply` / `git stash pop --index`).
 * Conflict and missing-ref failures map to typed errors for UI handling.
 */
export async function applyStash(
  repoRoot: string,
  stashRef: string,
  pop = false,
): Promise<void> {
  const trimmedRef = stashRef.trim();
  if (!trimmedRef) {
    throw new GitStashNotFoundError(stashRef, "Stash ref cannot be empty.");
  }

  const args = pop
    ? ["stash", "pop", "-q", "--index", trimmedRef]
    : ["stash", "apply", "-q", trimmedRef];

  const response = await runGit(repoRoot, args);
  if (response.exitCode !== 0) {
    const stderr = response.stderr.trim();
    if (isStashNotFoundResponse(stderr)) {
      throw new GitStashNotFoundError(trimmedRef, stderr || undefined);
    }
    if (isStashApplyConflictResponse(stderr)) {
      throw new GitStashApplyConflictError(trimmedRef, stderr);
    }
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
  DiffHunk,
  DiffLine,
  DiffLineKind,
  GitAvailableResponse,
  GitError,
  GitRemote,
  GitStashSummary,
  GitTagSummary,
  HistoryFilterMode,
  ParsedTextDiff,
  QueryCommitsOptions,
  RunGitResponse,
  WorkingTreeDiffSource,
  WorkingTreeFileEntry,
  WorkingTreeStatus,
} from "./types";
export { DEFAULT_COMMIT_LOG_LIMIT, DEFAULT_HISTORY_FILTER_MODE } from "./types";
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
