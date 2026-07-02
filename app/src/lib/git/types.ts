/** Result of a `run_git` Tauri command. */
export interface RunGitResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Result of the `git_available` Tauri command. */
export interface GitAvailableResponse {
  available: boolean;
  version: string | null;
  error: string | null;
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
}
