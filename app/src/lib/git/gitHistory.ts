import { parseUnifiedDiff } from "./gitDiffParse";
import {
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  parseCommitShow,
  parseLogCommits,
} from "./gitParse";
import { runGit } from "./gitRun";
import type { GitCallScope } from "./gitIntegrationGating";
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
  type RunGitResponse,
} from "./types";

/** Context lines for `git diff` / `git show --patch` (D-02). */
export const DIFF_CONTEXT_LINES = 3;

/**
 * Wrap a commit-diff path as a literal git pathspec so filenames containing
 * glob metacharacters (`*`, `?`, `[`, `:`) or a leading `:` are not
 * interpreted by the pathspec parser. See `git glossary` on pathspec magic.
 */
function asLiteralPathspec(path: string): string {
  return `:(literal)${path}`;
}

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

  // `--skip=N` must precede the limit so `git log --skip=N -L` returns the
  // (N+1)..(N+L) window — used for incremental "load more" pagination.
  if (options.skip !== undefined && options.skip > 0) {
    args.push(`--skip=${options.skip}`);
  }
  args.push(`-${limit}`);
  return args;
}

/**
 * Detect `git log`'s unborn-HEAD fatal. In a freshly `git init`-ed repo with
 * no commits, `git log` exits 128 with a message like
 * `fatal: your current branch 'main' does not have any commits yet`. Rather
 * than surfacing that fatal as a load error, callers treat it as an empty
 * history so the existing "No commits yet" empty state renders.
 */
export function isUnbornRepoLogError(response: RunGitResponse): boolean {
  if (response.exitCode === 0) {
    return false;
  }
  return /does not have any commits yet/i.test(response.stderr);
}

/**
 * Query commit history using structured `git log` output.
 * Returns commits newest-first (default `git log` order).
 *
 * An unborn HEAD (freshly init'd repo, no commits) resolves to an empty list
 * instead of throwing the raw `git log` fatal, so the panel can render its
 * dedicated empty state.
 */
export async function queryCommits(
  repoRoot: string,
  options: QueryCommitsOptions = {},
  scope: GitCallScope = "versionControl",
): Promise<CommitSummary[]> {
  const response = await runGit(repoRoot, buildQueryCommitsArgs(options), scope);
  if (response.exitCode !== 0) {
    if (isUnbornRepoLogError(response)) {
      return [];
    }
    throw createGitCommandError(response);
  }

  return parseLogCommits(response.stdout);
}

/**
 * Query full commit metadata and changed files for one revision.
 * Uses `git show --name-status --format=…` (no diff hunks).
 */
export async function queryCommitDetail(
  repoRoot: string,
  sha: string,
  scope: GitCallScope = "versionControl",
): Promise<CommitDetail> {
  const response = await runGit(
    repoRoot,
    [
      "show",
      // Match `queryCommits`/`queryStashes`: suppress interleaved gpg signature
      // lines when `log.showSignature = true`, which the fixed-NUL metadata scan
      // cannot tolerate.
      "--no-show-signature",
      // F29 (H10): a merge commit renders as a *combined* diff by default, and
      // `git show --name-status <merge>` prints zero file rows (verified on a real
      // merge). `--first-parent` makes the name-status list describe what the
      // merge brought in relative to its first parent — the intuitive "files
      // changed by this merge" view — and emits a single section the parser
      // already handles. (`-m` would emit one per-parent section and require
      // parser changes; `--cc` prints none.)
      "--first-parent",
      "--name-status",
      `--format=${GIT_SHOW_FORMAT}`,
      sha,
    ],
    scope,
  );
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
  scope: GitCallScope = "versionControl",
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
          asLiteralPathspec(normalizedPath),
        ]
      : [
          "show",
          "--no-color",
          "--no-show-signature",
          "--patch",
          `--unified=${DIFF_CONTEXT_LINES}`,
          sha,
          "--",
          asLiteralPathspec(normalizedPath),
        ];

  const response = await runGit(repoRoot, args, scope);
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
