import { invoke } from "@tauri-apps/api/core";
import { isWindows } from "../services/platform";
import { parseUnifiedDiff } from "./gitDiffParse";
import {
  parseStatusPorcelainV2Z,
  splitWorkingTreeStatus,
} from "./gitParse";
import { enqueueGitCommandForRepo } from "./gitCommandQueue";
import { COMMIT_FILE_DIFF_MAX_BYTES, DIFF_CONTEXT_LINES } from "./gitHistory";
import {
  gitCommitInvokeArgs,
  LOCAL_GIT_OPERATION_TIMEOUT_MS,
  logGitCommandSummary,
  runGit,
} from "./gitRun";
import {
  assertGitCommandCompleted,
  GitCommitFileDiffNotFoundError,
  GitCommitValidationError,
  GitDiffTooLargeError,
  isGitCommandCancelledError,
  isGitCommandTimedOutError,
} from "./gitErrors";
import {
  createGitCommandError,
  isGitError,
  mapGitInvokeError,
  normalizeGitOutputPath,
  type CancellableGitOptions,
  type ParsedTextDiff,
  type RunGitResponse,
  type WorkingTreeDiffSource,
  type WorkingTreeStatus,
} from "./types";

const WORKING_TREE_STATUS_ARGS = ["status", "--porcelain=v2", "-z"] as const;

function gitNullDevicePath(): string {
  return isWindows() ? "NUL" : "/dev/null";
}

/**
 * Wrap a working-tree path as a literal git pathspec.
 *
 * A bare `-- <path>` argument is interpreted as a pathspec, so names
 * containing glob metacharacters (`*`, `?`, `[`, `:`) match other files or
 * fail outright (`:(literal)` is the magic-word form). Prefixing every path
 * with `:(literal)` forces git to treat it as a literal relative path,
 * preserving the leading-`/`-anchored-but-relative semantics the app relies
 * on. No quoting is needed: pathspec values are passed as separate argv
 * entries, never joined into a single string.
 */
function asLiteralPathspec(path: string): string {
  return `:(literal)${path}`;
}

function asLiteralPathspecs(paths: readonly string[]): string[] {
  return paths.map((path) => asLiteralPathspec(path));
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

function findParsedTextDiff(
  parsed: ReturnType<typeof parseUnifiedDiff>,
  path: string,
): ReturnType<typeof parseUnifiedDiff>[number] | undefined {
  const normalizedPath = normalizeGitOutputPath(path);
  return parsed.find(
    (diff) => diff.path === normalizedPath || diff.oldPath === normalizedPath,
  );
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
 * Query staged and unstaged working-tree files via `git status --porcelain=v2 -z`.
 */
export async function queryWorkingTreeStatus(repoRoot: string): Promise<WorkingTreeStatus> {
  const response = await runGit(repoRoot, [...WORKING_TREE_STATUS_ARGS]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return splitWorkingTreeStatus(parseStatusPorcelainV2Z(response.stdout));
}

/** Returns true when porcelain status has any entries (dirty working tree). */
export async function isWorkingTreeDirty(repoRoot: string): Promise<boolean> {
  const response = await runGit(repoRoot, [...WORKING_TREE_STATUS_ARGS]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseStatusPorcelainV2Z(response.stdout).length > 0;
}

/** Stage selected paths (`git add -- …`). */
export async function stagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const response = await runGit(repoRoot, ["add", "--", ...asLiteralPathspecs(paths)]);
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Stage all unstaged changes (`git add -A`). */
export async function stageAll(repoRoot: string): Promise<void> {
  const response = await runGit(repoRoot, ["add", "-A"]);
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/** Unstage selected paths (`git restore --staged -- …`). */
export async function unstagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const response = await runGit(repoRoot, [
    "restore",
    "--staged",
    "--",
    ...asLiteralPathspecs(paths),
  ]);
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }
}

/**
 * Fetch and parse a single working-tree file diff.
 *
 * **Staged** (`git diff --cached`): compares the index to `HEAD`.
 *
 * **Unstaged** (`git diff HEAD`): compares the working tree to `HEAD`.
 * Untracked paths fall back to `git diff --no-index` against the platform null device.
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
      // Defeat a configured `diff.external` so output is always unified-diff format.
      "--no-ext-diff",
      `--unified=${DIFF_CONTEXT_LINES}`,
      "--cached",
      "--",
      asLiteralPathspec(normalizedPath),
    ]);
    assertDiffCommandSuccess(response, false);
    return parseWorkingTreeFileDiffPatch(response.stdout, normalizedPath);
  }

  const headResponse = await runGit(repoRoot, [
    "diff",
    "--no-color",
    "--patch",
    "--no-ext-diff",
    `--unified=${DIFF_CONTEXT_LINES}`,
    "HEAD",
    "--",
    asLiteralPathspec(normalizedPath),
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
    // `--no-index` takes two literal file paths, not pathspecs, so the
    // `:(literal)` magic-word form used for the working-tree diffs above does
    // not apply here (git would try to open a file literally named
    // `:(literal)…`). The path is the already-normalized absolute/relative
    // working-tree path of the untracked file the user selected.
    normalizedPath,
  ]);
  assertDiffCommandSuccess(untrackedResponse, true);

  if (!untrackedResponse.stdout.trim()) {
    throw new GitCommitFileDiffNotFoundError(normalizedPath);
  }

  return parseWorkingTreeFileDiffPatch(untrackedResponse.stdout, normalizedPath);
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
      // Auto-register the commit so it is drainable on app exit (a mid-flight commit
      // holds `.git/index.lock`; quitting must reap it, not orphan it). Callers may
      // still pass an explicit commandId to make it user-cancellable.
      const commandId = options?.commandId ?? crypto.randomUUID();
      const response = await invoke<RunGitResponse>(
        "git_commit_with_message",
        gitCommitInvokeArgs(repoRoot, trimmed, {
          commandId,
          timeoutMs: LOCAL_GIT_OPERATION_TIMEOUT_MS,
        }),
      );
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
