import { queryRemotes } from "./gitService";
import { resolveRepoRoot } from "./gitRepo";
import { normalizeGitOutputPath, type GitRemote } from "./types";
import {
  subscribeVersionControlMutations,
  type VersionControlMutationScope,
} from "./versionControlRefresh";

/**
 * P03-08-09 — short-TTL per-repo remotes cache.
 *
 * `queryRemotes` was called from three places inside the Version Control view
 * (the view itself on probe, the Tags panel on mount, and the Tags panel on
 * refresh), so a single VC remount fanned out redundant `git remote -v`
 * subprocesses. Remotes change rarely — only `git remote add`/`rename`/`rm`
 * (which the app surfaces as mutations) move them — so a short TTL collapses
 * those calls into one per repo per visit.
 *
 * The cache is keyed by the resolved repository root (what callers pass to
 * `loadRemotes`), while VC mutations are notified with the workspace path.
 * Those two differ when a workspace is opened as a subdirectory of a repo, so
 * invalidation drops every cached root that contains the workspace path —
 * otherwise a subdirectory workspace's remotes would stay stale for the full
 * TTL.
 */
const REMOTES_TTL_MS = 30_000;

interface CachedRemotes {
  at: number;
  remotes: GitRemote[];
}

const cacheByRepoRoot = new Map<string, CachedRemotes>();
let mutationHookInstalled = false;
/**
 * Bumped on every invalidation. A `loadRemotes` call only stores its result
 * when no invalidation happened while its `git remote -v` was in flight, so a
 * pre-mutation answer can never overwrite the invalidation.
 */
let invalidationGeneration = 0;

function cacheKey(path: string): string {
  return normalizeGitOutputPath(path);
}

function isSameOrAncestorPath(ancestor: string, path: string): boolean {
  return path === ancestor || path.startsWith(ancestor.endsWith("/") ? ancestor : `${ancestor}/`);
}

function ensureMutationHook(): void {
  if (mutationHookInstalled) {
    return;
  }
  mutationHookInstalled = true;
  // Any VC mutation could change the configured remotes (a `remote add` during
  // a fetch/pull/push flow, a branch operation that updates tracking). Drop the
  // cached entry so the next read re-shells-out.
  subscribeVersionControlMutations((workspaceRootPath: string, scope: VersionControlMutationScope) => {
    // Index and working-tree edits never touch remote configuration.
    if (scope === "stage" || scope === "workspace-edit") return;
    invalidateRemotesForWorkspace(workspaceRootPath);
  });
}

/**
 * Drop cached remotes for the repository that contains `workspaceRootPath`.
 *
 * Runs synchronously so a listener that reloads remotes in the same tick never
 * sees the stale entry: the repo root is the workspace path itself or one of
 * its ancestors, so every cached root that contains the workspace path is
 * dropped. A follow-up resolution through `resolveRepoRoot` (cached after the
 * first call) also covers roots that differ only by symlinks.
 */
function invalidateRemotesForWorkspace(workspaceRootPath: string): void {
  invalidationGeneration += 1;
  const workspaceKey = cacheKey(workspaceRootPath);
  for (const key of [...cacheByRepoRoot.keys()]) {
    if (isSameOrAncestorPath(key, workspaceKey)) {
      cacheByRepoRoot.delete(key);
    }
  }
  void resolveRepoRoot(workspaceRootPath, "background")
    .then((repoResult) => {
      if (repoResult.ok && cacheByRepoRoot.delete(cacheKey(repoResult.repoRoot))) {
        invalidationGeneration += 1;
      }
    })
    .catch(() => undefined);
}

/**
 * Read remotes for `repoRoot`, reusing a fresh cached result when available.
 * `force` bypasses the cache (manual refresh).
 *
 * Note: keyed by `repoRoot` (the resolved repository root), not the workspace
 * path — callers resolve the repo root before calling.
 */
export async function loadRemotes(
  repoRoot: string,
  options?: { force?: boolean },
): Promise<GitRemote[]> {
  ensureMutationHook();
  const key = cacheKey(repoRoot);
  if (!options?.force) {
    const cached = cacheByRepoRoot.get(key);
    if (cached && Date.now() - cached.at < REMOTES_TTL_MS) {
      return cached.remotes;
    }
  }
  const generation = invalidationGeneration;
  const remotes = await queryRemotes(repoRoot, "versionControl");
  if (generation === invalidationGeneration) {
    cacheByRepoRoot.set(key, { at: Date.now(), remotes });
  }
  return remotes;
}

/** Drop the cached remotes for one repo root. */
export function invalidateRemotesCache(repoRoot: string): void {
  invalidationGeneration += 1;
  cacheByRepoRoot.delete(cacheKey(repoRoot));
}

/** Clear all cached remotes (tests only). */
export function resetRemotesCacheForTests(): void {
  cacheByRepoRoot.clear();
}
