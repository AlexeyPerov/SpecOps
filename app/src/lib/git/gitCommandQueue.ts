import { normalizeGitOutputPath } from "./types";

/**
 * P03-08-08 — which lane a git command runs on for its repository.
 *
 * - `"mutation"`: write commands (`add`/`commit`/`checkout`/`stash`/`fetch`/`pull`/
 *   `push`/`tag`/…). Serialized FIFO per repo so they never contend over
 *   `.git/index.lock`.
 * - `"read"`: read commands (`status`/`diff`/`log`/`show`/`rev-parse`/…). Run on
 *   a small concurrent lane so multiple reads of the same repo proceed in
 *   parallel (bounded to avoid worker-pool starvation), and so a slow read
 *   never blocks a queued mutation.
 */
export type GitCommandLane = "mutation" | "read";

export interface EnqueueGitCommandOptions {
  lane?: GitCommandLane;
  /**
   * Optional abort signal. When the signal is already aborted before the
   * command starts, the queued entry rejects immediately instead of running.
   * (Once a command has started, aborting the signal only discards the result —
   * the underlying subprocess keeps running until it finishes or its Rust-side
   * timeout/cancel fires.)
   */
  signal?: AbortSignal;
}

/** Maximum number of concurrent read commands per repository root. */
const MAX_CONCURRENT_READS_PER_REPO = 4;

interface RepoLanes {
  /** The repo-root key this entry is filed under (for self-eviction). */
  key: string;
  /** Mutation tail — mutations chain off this so they serialize. */
  mutationTail: Promise<unknown>;
  /** Number of read commands currently running for this repo. */
  activeReads: number;
  /** Queue of read waiters when the read lane is saturated. */
  readWaiters: Array<() => void>;
  /**
   * The mutation tail captured at the time the latest eviction callback was
   * scheduled. Eviction re-checks that this still equals {@link mutationTail}
   * before deleting the lane entry, so a mutation that chained on between the
   * schedule and the settle does not get evicted out from under a not-yet-run
   * successor (which would break FIFO serialization / index-lock safety).
   */
  evictionScheduledFrom: Promise<unknown> | null;
}

const lanesByRepoRoot = new Map<string, RepoLanes>();

function queueKeyForRepo(repoRoot: string): string {
  return normalizeGitOutputPath(repoRoot);
}

function getOrCreateLanes(key: string): RepoLanes {
  const existing = lanesByRepoRoot.get(key);
  if (existing) {
    return existing;
  }
  const lanes: RepoLanes = {
    key,
    mutationTail: Promise.resolve(),
    activeReads: 0,
    readWaiters: [],
    evictionScheduledFrom: null,
  };
  lanesByRepoRoot.set(key, lanes);
  return lanes;
}

/**
 * Acquire a read slot, waiting when the per-repo concurrency cap is reached.
 * Resolves once a slot is free (or immediately if the signal aborts first).
 */
function acquireReadSlot(lanes: RepoLanes, signal?: AbortSignal): Promise<void> {
  if (lanes.activeReads < MAX_CONCURRENT_READS_PER_REPO) {
    lanes.activeReads += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const waiter = (): void => {
      if (lanes.activeReads < MAX_CONCURRENT_READS_PER_REPO) {
        lanes.activeReads += 1;
        resolve();
      }
    };
    lanes.readWaiters.push(waiter);
    // If the caller aborts while waiting, drop the waiter and resolve so the
    // command function can observe the signal and bail.
    signal?.addEventListener(
      "abort",
      () => {
        const index = lanes.readWaiters.indexOf(waiter);
        if (index >= 0) {
          lanes.readWaiters.splice(index, 1);
        }
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Release a read slot and wake the next waiter, then evict the repo's lane
 * entry once both lanes have fully settled. P03-08-08: the entry was never
 * deleted before, a slow leak that grew the map by one entry per repo ever
 * touched.
 */
function releaseReadSlot(lanes: RepoLanes): void {
  lanes.activeReads -= 1;
  const next = lanes.readWaiters.shift();
  if (next) {
    next();
    return;
  }
  maybeEvictLanes(lanes);
}

/**
 * Drop the repo's lane entry when no mutation is pending and no read is active
 * or waiting. Checks the mutation tail asynchronously because the settled
 * promise may not have scheduled its `then` yet.
 *
 * P03-08-08 race guard: the eviction callback captures the mutation tail it was
 * scheduled from and re-checks that the lane's current {@link RepoLanes.mutationTail}
 * is still that same promise before deleting the entry. Without this, a new
 * mutation M2 chaining onto the tail between the schedule and the settle would
 * be evicted out from under a not-yet-run M2 (whose `fn` is still queued behind
 * the just-settled predecessor), so a later M3 would create a fresh lane and run
 * concurrently with M2 — breaking the FIFO-serial mutation guarantee that
 * protects `.git/index.lock`.
 */
function maybeEvictLanes(lanes: RepoLanes): void {
  if (lanes.activeReads !== 0 || lanes.readWaiters.length !== 0) {
    return;
  }
  // Already an eviction check pending for this tail — no need to schedule again.
  if (lanes.evictionScheduledFrom === lanes.mutationTail) {
    return;
  }
  const scheduledFrom = lanes.mutationTail;
  lanes.evictionScheduledFrom = scheduledFrom;
  void scheduledFrom.then(() => {
    // Clear the scheduling marker first; if a new mutation chained on after this
    // point it has already set a fresh `mutationTail` and scheduled its own check.
    if (lanes.evictionScheduledFrom === scheduledFrom) {
      lanes.evictionScheduledFrom = null;
    }
    // Re-read in case a new command arrived between the check and the settle.
    // The `mutationTail === scheduledFrom` check is the race guard: a mutation
    // that chained on since we scheduled means a successor is still queued (its
    // `fn` has not run yet), so the entry must not be evicted.
    const current = lanesByRepoRoot.get(lanes.key);
    if (
      current === lanes &&
      current.mutationTail === scheduledFrom &&
      current.evictionScheduledFrom === null &&
      current.activeReads === 0 &&
      current.readWaiters.length === 0
    ) {
      lanesByRepoRoot.delete(lanes.key);
    }
  });
}

/**
 * Serialize git subprocess work per repository root.
 * Unrelated repositories run concurrently; the same repo is FIFO for mutations
 * and bounded-concurrent for reads (P03-08-08).
 *
 * Reads never block on mutations and vice versa: a slow read-only command (a
 * hung `git status`) can no longer wedge the repo's queued writes, and a slow
 * remote mutation can no longer stall local reads.
 */
export function enqueueGitCommandForRepo<T>(
  repoRoot: string,
  fn: () => Promise<T>,
  options?: EnqueueGitCommandOptions,
): Promise<T> {
  const key = queueKeyForRepo(repoRoot);
  const lanes = getOrCreateLanes(key);
  const lane = options?.lane ?? "read";

  // P03-08-08: drop queued (not-yet-started) commands whose signal already
  // fired, instead of running them just to discard the result.
  if (options?.signal?.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  if (lane === "mutation") {
    const previous = lanes.mutationTail;
    const next = previous.then(fn, fn);
    // Keep the chain alive regardless of the command's outcome, then evict
    // when the tail settles and no reads are in flight.
    lanes.mutationTail = next.then(
      () => {
        maybeEvictLanes(lanes);
      },
      () => {
        maybeEvictLanes(lanes);
      },
    );
    return next;
  }

  // Read lane: bounded-concurrent.
  const run = async (): Promise<T> => {
    await acquireReadSlot(lanes, options?.signal);
    try {
      if (options?.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return await fn();
    } finally {
      releaseReadSlot(lanes);
    }
  };
  return run();
}

/** Clear per-repo queue state (tests only). */
export function resetGitCommandQueueForTests(): void {
  lanesByRepoRoot.clear();
}
