import { parseLsRemoteTags, parseRemoteVvLines } from "./gitParse";
import { queryCurrentBranch } from "./gitRepo";
import { runGit, runRemoteGit } from "./gitRun";
import {
  assertGitCommandCompleted,
  GitNoUpstreamError,
  GitRefValidationError,
} from "./gitErrors";
import {
  createGitCommandError,
  type CancellableGitOptions,
  type GitRemote,
} from "./types";

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

/**
 * Resolve a push target's branch name from the configured upstream when the caller
 * supplied a remote but no branch. Returns the original `target` unchanged when an
 * explicit branch was given, when there is no target, or when the upstream cannot
 * be resolved (detached HEAD / no tracking branch) — in those cases the caller's
 * `HEAD` default applies.
 */
async function resolvePushTarget(
  repoRoot: string,
  target?: RemoteOperationTarget,
): Promise<RemoteOperationTarget | undefined> {
  if (!target?.remoteName?.trim()) {
    return target;
  }
  if (target.branchName?.trim()) {
    return target;
  }
  try {
    const current = await queryCurrentBranch(repoRoot);
    if (current.isDetached || !current.upstream) {
      return target;
    }
    // `upstream` is `<remote>/<branch>`; only use it when it points at the same
    // remote the user selected, so the derived branch name is the right one.
    const upstreamRemote = current.upstream.slice(0, current.upstream.indexOf("/"));
    if (upstreamRemote !== target.remoteName.trim()) {
      return target;
    }
    const upstreamBranch = current.upstream.slice(current.upstream.indexOf("/") + 1);
    if (!upstreamBranch) {
      return target;
    }
    return { remoteName: target.remoteName, branchName: upstreamBranch };
  } catch {
    // Branch resolution is best-effort; never block a push on it.
    return target;
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

/** Push to upstream, or to an explicit remote (and optional branch). */
export async function pushRemote(
  repoRoot: string,
  target?: RemoteOperationTarget,
  options?: CancellableGitOptions,
): Promise<void> {
  // When the caller selected a remote but left the branch blank, push the current
  // branch to the remote branch name it tracks (e.g. a local `feature` tracking
  // `origin/main` pushes to `main`, not to a stray `feature`). Falls back to a
  // plain `HEAD` push only when there is no upstream to derive a name from or the
  // current branch is detached.
  const resolvedTarget = await resolvePushTarget(repoRoot, target);
  const response = await runRemoteGit(repoRoot, buildPushArgs(resolvedTarget), {
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

export function validateRemoteName(remoteName: string): void {
  const trimmed = remoteName.trim();
  if (!trimmed) {
    throw new GitRefValidationError("Remote name cannot be empty.");
  }
}
