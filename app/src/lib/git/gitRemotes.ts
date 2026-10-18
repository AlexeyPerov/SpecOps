import { validateGitRefName } from "./gitRefName";
import { pullOptionArgs, queryGitOperationState, type PullOptions, type PullSnapshot } from "./gitPull";
import { parseLsRemoteTags, parseRemoteVvLines } from "./gitParse";
import { queryCurrentBranch } from "./gitRepo";
import { runGit, runRemoteGit } from "./gitRun";
import type { GitCallScope } from "./gitIntegrationGating";
import {
  assertGitCommandCompleted,
  combinedGitOutput,
  GitNoUpstreamError,
  GitPullConflictError,
  GitRefValidationError,
  isGitConflictOutput,
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

export function buildPullArgs(target?: RemoteOperationTarget, options?: PullOptions): string[] {
  const flags = options ? pullOptionArgs(options) : [];
  if (target) {
    validateRemoteName(target.remoteName);
    if (target.branchName && !validateGitRefName(target.branchName).ok) throw new GitRefValidationError('Invalid remote branch.');
  }
  if (!target?.remoteName?.trim()) {
    return ["pull", ...flags];
  }
  const remoteName = target.remoteName.trim();
  const branchName = target.branchName?.trim();
  return branchName ? ["pull", ...flags, remoteName, branchName] : ["pull", ...flags, remoteName];
}

function buildPushArgs(target?: RemoteOperationTarget): string[] {
  if (!target?.remoteName?.trim()) {
    return ["push"];
  }
  validateRemoteName(target.remoteName);
  const remoteName = target.remoteName.trim();
  const branchName = target.branchName?.trim();
  if (!branchName) {
    return ["push", remoteName, "HEAD"];
  }
  if (!validateGitRefName(branchName).ok) {
    throw new GitRefValidationError("Invalid remote branch.");
  }
  // `branchName` names the destination branch on the remote. A bare `<name>`
  // refspec would push the *local* branch of that name, so push the current
  // HEAD to the remote branch explicitly.
  return ["push", remoteName, `HEAD:refs/heads/${branchName}`];
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
  scope: GitCallScope = "versionControl",
): Promise<RemoteOperationTarget | undefined> {
  if (!target?.remoteName?.trim()) {
    return target;
  }
  if (target.branchName?.trim()) {
    return target;
  }
  try {
    const current = await queryCurrentBranch(repoRoot, scope);
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

/// F35 (L15): in detached HEAD, a plain `git push <remote> HEAD` is rejected
/// with "The destination you provided is not a full refname" plus the hint
/// "Did you mean to create a new branch by pushing to 'HEAD:refs/heads/HEAD'?".
/// `isNoUpstreamPushError` does not match that wording, so the failure surfaced
/// as a generic command error. Detect it and map to a typed upstream-style
/// error so the UI can tell the user to checkout a branch first.
function isDetachedHeadPushError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("not a full refname") ||
    lower.includes("did you mean to create a new branch by pushing to")
  );
}

/**
 * List configured remotes via `git remote -v`.
 * Returns remotes sorted by name; empty when none are configured.
 */
export async function queryRemotes(
  repoRoot: string,
  scope: GitCallScope = "versionControl",
): Promise<GitRemote[]> {
  const response = await runGit(repoRoot, ["remote", "-v"], scope);
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
  scope: GitCallScope = "versionControl",
): Promise<string[]> {
  const trimmedRemote = remoteName.trim();
  if (!trimmedRemote) {
    throw new GitRefValidationError("Remote name cannot be empty.");
  }

  const response = await runRemoteGit(
    repoRoot,
    ["ls-remote", "--tags", trimmedRemote],
    scope,
    { ...options, operation: "lsRemote" },
  );
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseLsRemoteTags(response.stdout);
}

/** Query remote heads using the shared authenticated, cancellable runner. */
export async function queryRemoteHeads(repoRoot: string, remoteName: string, options?: CancellableGitOptions & { configuredPushUrl?: string }): Promise<string[]> {
  validateRemoteName(remoteName);
  const response = await runRemoteGit(repoRoot, ['ls-remote', '--heads', options?.configuredPushUrl || remoteName], 'versionControl', { ...options, operation: 'lsRemote' });
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) throw createGitCommandError(response);
  return [...new Set(response.stdout.split('\n').flatMap(line => {
    const match = line.match(/^[a-f\d]+\s+refs\/heads\/(.+)$/i);
    return match ? [match[1]!] : [];
  }))].sort((a, b) => a.localeCompare(b));
}

/** Fetch from all remotes, or a single remote when `target` is set. */
export async function fetchRemote(
  repoRoot: string,
  target?: RemoteOperationTarget,
  options?: CancellableGitOptions,
  scope: GitCallScope = "versionControl",
): Promise<void> {
  const response = await runRemoteGit(repoRoot, buildFetchArgs(target), scope, {
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
  options?: CancellableGitOptions & { pull?: PullOptions; expected?: PullSnapshot },
  scope: GitCallScope = "versionControl",
): Promise<void> {
  if (options?.pull) {
    const state = await queryGitOperationState(repoRoot);
    if (state.kind !== 'none' || state.conflicts.length) throw new Error('Finish the current Git operation or resolve conflicts before pulling.');
  }
  const response = await runRemoteGit(repoRoot, buildPullArgs(target, options?.pull), scope, {
    ...options,
    // Verified inside the mutation lane, after earlier queued branch mutations.
    expectedHead: options?.expected,
    operation: "pull",
  });
  assertGitCommandCompleted(response);
  if (response.exitCode !== 0) {
    const output = combinedGitOutput(response);
    if (isGitConflictOutput(output)) {
      throw new GitPullConflictError(output.trim());
    }
    throw createGitCommandError(response);
  }
}

/** Push to upstream, or to an explicit remote (and optional branch). */
export async function pushRemote(
  repoRoot: string,
  target?: RemoteOperationTarget,
  options?: CancellableGitOptions,
  scope: GitCallScope = "versionControl",
): Promise<void> {
  // When the caller selected a remote but left the branch blank, push the current
  // branch to the remote branch name it tracks (e.g. a local `feature` tracking
  // `origin/main` pushes to `main`, not to a stray `feature`). Falls back to a
  // plain `HEAD` push only when there is no upstream to derive a name from or the
  // current branch is detached.
  const resolvedTarget = await resolvePushTarget(repoRoot, target, scope);
  const response = await runRemoteGit(repoRoot, buildPushArgs(resolvedTarget), scope, {
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
    if (isDetachedHeadPushError(response.stderr)) {
      // F35: detached HEAD cannot be pushed as `HEAD` — git needs a full refspec.
      // Tell the user to checkout a branch first rather than surfacing the raw
      // "not a full refname" / "did you mean HEAD:refs/heads/HEAD" wording.
      throw new GitNoUpstreamError(
        "Detached HEAD cannot be pushed. Checkout a branch before pushing.",
        null,
      );
    }
    throw createGitCommandError(response);
  }
}

export function validateRemoteName(remoteName: string): void {
  const trimmed = remoteName.trim();
  if (!trimmed || trimmed.startsWith("-") || /[\s\x00-\x1f]/.test(trimmed)) {
    throw new GitRefValidationError("Remote name is invalid.");
  }
}
