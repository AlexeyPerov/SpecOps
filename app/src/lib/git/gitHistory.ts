import { parseUnifiedDiff } from "./gitDiffParse";
import {
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  parseCommitShow,
  parseLogCommits,
} from "./gitParse";
import { runGit } from "./gitRun";
import {
  GitCommitFileDiffNotFoundError,
  GitDiffTooLargeError,
} from "./gitErrors";
import {
  createGitCommandError,
  DEFAULT_COMMIT_LOG_LIMIT,
  DEFAULT_HISTORY_FILTER_MODE,
  normalizeGitOutputPath,
  type CommitDetail,
  type CommitSummary,
  type ParsedTextDiff,
  type QueryCommitsOptions,
} from "./types";

/** Context lines for `git diff` / `git show --patch` (D-02). */
export const DIFF_CONTEXT_LINES = 3;

/**
 * Maximum `git diff` / `git show --patch` stdout length parsed in the UI
 * (512 KiB). Larger patches throw {@link GitDiffTooLargeError}.
 */
export const COMMIT_FILE_DIFF_MAX_BYTES = 512 * 1024;

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
 * `parentSha`) use `git show <sha> -- <path>`. Renamed files may be requested
 * by either the new path or the previous path in the parsed diff.
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
