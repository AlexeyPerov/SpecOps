import { parseStashList, parseTagList, GIT_STASH_LIST_FORMAT } from "./gitParse";
import { runGit, runRemoteGit } from "./gitRun";
import { validateGitRefName } from "./gitRefName";
import {
  assertGitCommandCompleted,
  GitRefValidationError,
  GitStashApplyConflictError,
  GitStashNotFoundError,
  GitStashNothingToSaveError,
  GitTagPartialDeleteError,
} from "./gitErrors";
import {
  createGitCommandError,
  type CancellableGitOptions,
  type GitStashSummary,
  type RunGitResponse,
} from "./types";
import { validateRemoteName } from "./gitRemotes";

/** Query local tags via `git tag -l`. Returns tag names sorted alphabetically. */
export async function queryTags(repoRoot: string): Promise<string[]> {
  const response = await runGit(repoRoot, ["tag", "-l"]);
  if (response.exitCode !== 0) {
    throw createGitCommandError(response);
  }

  return parseTagList(response.stdout);
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
): Promise<string> {
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

  const refResponse = await runGit(repoRoot, ["rev-parse", "--verify", "stash@{0}"]);
  if (refResponse.exitCode !== 0) {
    throw createGitCommandError(refResponse);
  }

  const stashRef = refResponse.stdout.trim();
  if (!stashRef) {
    throw createGitCommandError({
      ...refResponse,
      exitCode: refResponse.exitCode || 1,
      stderr: refResponse.stderr || "Failed to resolve stash ref after push",
    });
  }

  return stashRef;
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

/** Drop a stash ref (`git stash drop`). Missing refs map to {@link GitStashNotFoundError}. */
export async function dropStash(repoRoot: string, stashRef: string): Promise<void> {
  const trimmedRef = stashRef.trim();
  if (!trimmedRef) {
    throw new GitStashNotFoundError(stashRef, "Stash ref cannot be empty.");
  }

  const response = await runGit(repoRoot, ["stash", "drop", "-q", trimmedRef]);
  if (response.exitCode !== 0) {
    const stderr = response.stderr.trim();
    if (isStashNotFoundResponse(stderr)) {
      throw new GitStashNotFoundError(trimmedRef, stderr || undefined);
    }
    throw createGitCommandError(response);
  }
}

export { GIT_STASH_LIST_FORMAT };
