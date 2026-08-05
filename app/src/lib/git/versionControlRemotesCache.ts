import { queryRemotes } from "./gitService";
import { resolveRepoRoot } from "./gitRepo";
import type { GitRemote } from "./types";
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
 * invalidation resolves the repo root from the workspace path (sync-cached by
 * P03-08-06's `resolveRepoRoot`) before dropping the entry — otherwise a
 * subdirectory workspace's remotes would stay stale for the full TTL.
 */
const REMOTES_TTL_MS = 30_000;

interface CachedRemotes {
  at: number;
  remotes: GitRemote[];
}

const cacheByRepoRoot = new Map<string, CachedRemotes>();
let mutationHookInstalled = false;

function ensureMutationHook(): void {
  if (mutationHookInstalled) {
    return;
  }
  mutationHookInstalled = true;
  // Any VC mutation could change the configured remotes (a `remote add` during
  // a fetch/pull/push flow, a branch operation that updates tracking). Drop the
  // cached entry so the next read re-shells-out.
  subscribeVersionControlMutations((workspaceRootPath: string, _scope: VersionControlMutationScope) => {
    void invalidateRemotesForWorkspace(workspaceRootPath);
  });
}

/**
 * Resolve the mutation's workspace path to its repository root and drop the
 * cached remotes for that root. Fire-and-forget: `resolveRepoRoot` is
 * sync-cached per workspace path (P03-08-06), so after the first resolution
 * this completes without a subprocess. If resolution fails (not a repo), there
 * is nothing to invalidate.
 */
async function invalidateRemotesForWorkspace(workspaceRootPath: string): Promise<void> {
  const repoResult = await resolveRepoRoot(workspaceRootPath, "background").catch(() => null);
  if (repoResult?.ok) {
    cacheByRepoRoot.delete(repoResult.repoRoot);
    return;
  }
  // Not a repository or resolution failed: also drop any entry filed directly
  // under the workspace path (covers callers that passed the workspace path
  // itself as the repo root when the two coincide).
  cacheByRepoRoot.delete(workspaceRootPath);
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
  if (!options?.force) {
    const cached = cacheByRepoRoot.get(repoRoot);
    if (cached && Date.now() - cached.at < REMOTES_TTL_MS) {
      return cached.remotes;
    }
  }
  const remotes = await queryRemotes(repoRoot, "versionControl");
  cacheByRepoRoot.set(repoRoot, { at: Date.now(), remotes });
  return remotes;
}

/** Drop the cached remotes for one repo root. */
export function invalidateRemotesCache(repoRoot: string): void {
  cacheByRepoRoot.delete(repoRoot);
}

/** Clear all cached remotes (tests only). */
export function resetRemotesCacheForTests(): void {
  cacheByRepoRoot.clear();
}
