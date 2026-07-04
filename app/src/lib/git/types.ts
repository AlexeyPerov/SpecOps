/** Result of a `run_git` Tauri command. */
export interface RunGitResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when the subprocess was terminated by user-initiated cancellation. */
  cancelled?: boolean;
}

/** Result of the `git_available` Tauri command. */
export interface GitAvailableResponse {
  available: boolean;
  version: string | null;
  error: string | null;
}

/** Outcome of a `cancel_git_command` Tauri request. */
export type CancelGitCommandOutcome = "cancelled" | "notFound" | "alreadyFinished";

/** Result of the `cancel_git_command` Tauri command. */
export interface CancelGitCommandResponse {
  outcome: CancelGitCommandOutcome;
}

/** Optional cancellation handle for long-running git subprocesses. */
export interface CancellableGitOptions {
  commandId?: string;
  /** Enable in-app GIT_ASKPASS for credential prompts during this command. */
  askpass?: boolean;
  /** Operation context for askpass prompts. */
  askpassOperation?: GitAskpassOperation;
  /** Optional askpass request timeout in milliseconds. */
  askpassTimeoutMs?: number;
}

/** Remote git operation context surfaced in askpass prompts. */
export type GitAskpassOperation =
  | "fetch"
  | "pull"
  | "push"
  | "tagPush"
  | "tagDelete"
  | "lsRemote";

/** Credential input mode for an askpass request. */
export type GitAskpassInputKind = "username" | "password" | "passphrase";

/** Structured askpass request emitted while a remote git command runs. */
export interface GitAskpassRequest {
  sessionId: string;
  requestId: string;
  prompt: string;
  hostHint: string | null;
  usernameHint: string | null;
  inputKind: GitAskpassInputKind;
  operation: GitAskpassOperation | null;
  timeoutMs: number;
}

/** User response to an askpass request. */
export interface GitAskpassResponse {
  sessionId: string;
  requestId: string;
  value: string;
  cancelled?: boolean;
}

/** Workspace path is not inside a git repository. */
export interface GitNotARepositoryError {
  kind: "notARepository";
  message: string;
  workspaceRootPath: string;
}

/** A git subprocess failed with a non-success exit code. */
export interface GitCommandError {
  kind: "command";
  message: string;
  exitCode: number;
  stderr: string;
}

/** Invalid workspace path for git operations. */
export interface GitInvalidPathError {
  kind: "invalidPath";
  message: string;
  workspaceRootPath: string;
}

export type GitError = GitNotARepositoryError | GitCommandError | GitInvalidPathError;

export type ResolveRepoRootResult =
  | { ok: true; repoRoot: string }
  | { ok: false; error: GitNotARepositoryError };

export function isGitNotARepositoryError(error: unknown): error is GitNotARepositoryError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    (error as GitNotARepositoryError).kind === "notARepository"
  );
}

export function isGitError(error: unknown): error is GitError {
  if (typeof error !== "object" || error === null || !("kind" in error)) {
    return false;
  }
  const kind = (error as GitError).kind;
  return kind === "notARepository" || kind === "command" || kind === "invalidPath";
}

export function createGitNotARepositoryError(
  workspaceRootPath: string,
  stderr: string,
): GitNotARepositoryError {
  const trimmed = stderr.trim();
  return {
    kind: "notARepository",
    message: trimmed || "Path is not inside a git repository",
    workspaceRootPath,
  };
}

export function createGitCommandError(response: RunGitResponse): GitCommandError {
  const trimmed = response.stderr.trim();
  return {
    kind: "command",
    message: trimmed || `git exited with code ${response.exitCode}`,
    exitCode: response.exitCode,
    stderr: response.stderr,
  };
}

export function createGitInvalidPathError(
  workspaceRootPath: string,
  message: string,
): GitInvalidPathError {
  return {
    kind: "invalidPath",
    message,
    workspaceRootPath,
  };
}

function invokeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Map a failed Tauri `invoke` for git commands to a typed `GitError`. */
export function mapGitInvokeError(error: unknown, workspaceRootPath: string): GitError {
  const message = invokeErrorMessage(error);
  if (
    message.includes("repo_root must not be empty") ||
    message.includes("absolute path") ||
    message.includes("Failed to resolve repo_root path")
  ) {
    return createGitInvalidPathError(workspaceRootPath, message);
  }

  return {
    kind: "command",
    message,
    exitCode: -1,
    stderr: message,
  };
}

export function normalizeGitOutputPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Current branch metadata from `git branch --show-current` (+ upstream when attached). */
export interface CurrentBranchInfo {
  name: string;
  isDetached: boolean;
  upstream: string | null;
}

/** Ahead/behind counts relative to the tracking branch. */
export interface AheadBehindCounts {
  ahead: number;
  behind: number;
}

/** Default cap for `git log` queries (phase 2). */
export const DEFAULT_COMMIT_LOG_LIMIT = 500;

/** History scope for commit queries (D-10). */
export type HistoryFilterMode =
  | "current-branch"
  | "all-branches"
  | "all-branches-and-remotes";

/** Default history scope — current branch only (D-10). */
export const DEFAULT_HISTORY_FILTER_MODE: HistoryFilterMode = "current-branch";

/** Branch/tag ref decoration on a commit from `git log --decorate=full`. */
export type CommitDecoratorType =
  | "currentBranchHead"
  | "localBranchHead"
  | "currentCommitHead"
  | "remoteBranchHead"
  | "tag";

export interface CommitDecorator {
  type: CommitDecoratorType;
  name: string;
}

/** Parsed commit row for history list (phase 2). */
export interface CommitSummary {
  sha: string;
  parents: string[];
  refs: CommitDecorator[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  subject: string;
}

export interface QueryCommitsOptions {
  limit?: number;
  /** History scope; defaults to {@link DEFAULT_HISTORY_FILTER_MODE}. */
  filterMode?: HistoryFilterMode;
}

/** Status letter from `git show --name-status` file rows. */
export type CommitFileStatus = "A" | "M" | "D" | "R" | "C" | "T" | "U" | "X";

/** One changed path from commit detail name-status output. */
export interface CommitFileChange {
  status: CommitFileStatus;
  path: string;
  previousPath?: string;
}

/** Full commit metadata + changed files (phase 2 detail pane). */
export interface CommitDetail {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  committerName: string;
  committerEmail: string;
  committerTime: number;
  message: string;
  files: CommitFileChange[];
}

/** Configured remote from `git remote -v` (D-04). */
export interface GitRemote {
  name: string;
  fetchUrl: string | null;
  pushUrl: string | null;
}

/** Local tag row with optional default-remote presence hint (D-04). */
export interface GitTagSummary {
  name: string;
  onRemote?: boolean;
}

/** Local branch row from `git branch -vv` (phase 2). */
export interface BranchSummary {
  name: string;
  head: string;
  isCurrent: boolean;
  upstream: string | null;
  upstreamTrack: string | null;
  subject: string;
}

/** One working-tree file row from porcelain status (phase 3). */
export interface WorkingTreeFileEntry {
  path: string;
  indexStatus: string;
  workTreeStatus: string;
  statusCode: string;
}

/** Staged and unstaged file lists from `git status --porcelain` (phase 3). */
export interface WorkingTreeStatus {
  staged: WorkingTreeFileEntry[];
  unstaged: WorkingTreeFileEntry[];
}

/** Which side of the working tree to diff against (D-03). */
export type WorkingTreeDiffSource = "unstaged" | "staged";

/** Line kind within a parsed unified diff hunk (D-02). */
export type DiffLineKind = "context" | "added" | "deleted" | "hunk-header" | "meta";

/** One line from a parsed unified diff hunk. */
export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** One `@@ … @@` hunk from a unified diff. */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** One stash row from `git stash list -z --format=…` (D-07). */
export interface GitStashSummary {
  sha: string;
  parents: string[];
  /** Stash ref such as `stash@{0}` (newest first in list order). */
  ref: string;
  /** Committer time as Unix seconds when available. */
  createdAt: number;
  message: string;
}

/** Parsed text diff for one file from `git diff` / `git show` patch output (D-02). */
export interface ParsedTextDiff {
  path: string;
  oldPath?: string;
  hunks: DiffHunk[];
  addedLines: number;
  deletedLines: number;
  isBinary: boolean;
  oldMode?: string;
  newMode?: string;
}
