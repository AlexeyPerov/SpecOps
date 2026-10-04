import type { CommitSummary } from "../git/types";
import { queryCommits } from "../git/gitHistory";
import { resolveRepoRoot } from "../git/gitRepo";
import { isGitIntegrationEnabledInApp } from "../git/gitIntegrationGating";
import { getErrorMessage } from "../commands/commandErrors";
import { workspaceRelativePath } from "./workspacePaths";
import { appState } from "../state/appState";

/**
 * History of one path (a file or a folder) for the project-tree / tab "Git Log"
 * popup. Kept separate from the Version Control view's history: this is a
 * read-only peek scoped to a single path, invoked straight from a context menu.
 */

/** Commits fetched per page by the popup. */
export const PATH_GIT_LOG_PAGE_SIZE = 20;

export type PathGitLogResult =
  | { kind: "commits"; commits: CommitSummary[]; repoRoot: string; hasMore: boolean }
  | { kind: "not_a_repository" }
  | { kind: "disabled" }
  | { kind: "failed"; reason: string };

export interface LoadPathGitLogOptions {
  /** Absolute path of the file or folder whose history to read. */
  path: string;
  /** Workspace root the path belongs to; used to resolve the repository. */
  workspaceRoot: string;
  /** Whether `path` is a file — enables `--follow` across renames. */
  isFile: boolean;
  /** Commits already shown, for "Load more". */
  skip?: number;
  limit?: number;
}

/**
 * Read `git log` for one path. The call is user-initiated from a menu, so it
 * runs with the `versionControl` scope — the background scope is for passive UI
 * (badges, columns) that must stay quiet under "version control only".
 */
export async function loadPathGitLog(
  options: LoadPathGitLogOptions,
): Promise<PathGitLogResult> {
  if (!isGitIntegrationEnabledInApp()) {
    return { kind: "disabled" };
  }
  const limit = options.limit ?? PATH_GIT_LOG_PAGE_SIZE;
  try {
    const repoRootResult = await resolveRepoRoot(options.workspaceRoot, "versionControl");
    if (!repoRootResult.ok) {
      return { kind: "not_a_repository" };
    }
    const repoRoot = repoRootResult.repoRoot;
    // Pathspecs are resolved against the repository root, which is not always
    // the workspace root (a workspace can sit in a subdirectory of the repo).
    const relativePath = workspaceRelativePath(options.path, repoRoot);
    if (relativePath === null) {
      return { kind: "not_a_repository" };
    }
    const commits = await queryCommits(
      repoRoot,
      {
        // One extra row answers "is there another page?" without a count query.
        limit: limit + 1,
        skip: options.skip ?? 0,
        filterMode: "current-branch",
        paths: relativePath === "" ? [] : [relativePath],
        follow: options.isFile,
      },
      "versionControl",
    );
    return {
      kind: "commits",
      repoRoot,
      commits: commits.slice(0, limit),
      hasMore: commits.length > limit,
    };
  } catch (error: unknown) {
    return { kind: "failed", reason: getErrorMessage(error) };
  }
}

/** Workspace root that owns `path`, or null when no open workspace contains it. */
export function workspaceRootForPath(path: string): string | null {
  const snapshot = appState.getSnapshot();
  let best: string | null = null;
  for (const workspace of snapshot.contexts.workspaces) {
    if (workspaceRelativePath(path, workspace.rootPath) === null) {
      continue;
    }
    // Nested workspaces: the deepest containing root wins.
    if (!best || workspace.rootPath.length > best.length) {
      best = workspace.rootPath;
    }
  }
  return best;
}
