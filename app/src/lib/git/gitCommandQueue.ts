import { normalizeGitOutputPath } from "./types";

const queuesByRepoRoot = new Map<string, Promise<unknown>>();

function queueKeyForRepo(repoRoot: string): string {
  return normalizeGitOutputPath(repoRoot);
}

/**
 * Serialize git subprocess work per repository root.
 * Unrelated repositories run concurrently; the same repo is FIFO.
 */
export function enqueueGitCommandForRepo<T>(
  repoRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = queueKeyForRepo(repoRoot);
  const previous = queuesByRepoRoot.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  queuesByRepoRoot.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** Clear per-repo queue state (tests only). */
export function resetGitCommandQueueForTests(): void {
  queuesByRepoRoot.clear();
}
