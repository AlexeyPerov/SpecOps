/**
 * Serializes read-modify-write access to shared `session.json`.
 *
 * Both window session persistence and the open-file registry mutate the same
 * file. Without a queue, concurrent RMWs from different windows (or a persist
 * racing a registry sync) can drop entries.
 *
 * Two layers (H29 — each webview is its own JS realm, so a module-level
 * promise chain only serializes writers *within* one window):
 *
 * 1. An in-window promise chain, exactly as before.
 * 2. A cross-window lock directory (`session.json.lock` in the app data dir)
 *    acquired inside the chain. `mkdir` is atomic — it fails if the directory
 *    exists — which makes it a portable mutex between windows. Stale locks
 *    (crashed window) are broken by age; if the filesystem is unavailable
 *    (unit tests, startup races) locking degrades to the in-window chain
 *    instead of failing the write.
 *
 * Callers that nest multiple session mutations must run them inside a single
 * {@link withSessionWriteLock} callback (use unlocked helpers), not nest
 * separate lock acquisitions — awaiting inside a lock would otherwise allow
 * unsafe re-entry.
 */

import { mkdir, remove, stat } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { ensureSpecOpsDataDir } from "./appDataDir";

const LOCK_DIR_NAME = "session.json.lock";
/** A holder older than this is assumed crashed and its lock is broken. */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 40;
/** Give up waiting after this long and proceed with only the in-window chain. */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
/** Consecutive acquire failures before cross-window locking is disabled. */
const MAX_ACQUIRE_FAILURES = 3;

let writeChain: Promise<void> = Promise.resolve();

/**
 * Set after repeated environments failures (no Tauri IPC, data dir missing):
 * further writes skip the cross-window lock rather than paying the timeout on
 * every session write. The in-window chain still serializes local writers.
 */
let crossWindowLockDisabled = false;
let consecutiveAcquireFailures = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveLockPath(): Promise<string | null> {
  try {
    const dataDir = await ensureSpecOpsDataDir();
    return await join(dataDir, LOCK_DIR_NAME);
  } catch {
    return null;
  }
}

function noteAcquireFailure(): () => Promise<void> {
  consecutiveAcquireFailures += 1;
  if (consecutiveAcquireFailures >= MAX_ACQUIRE_FAILURES) {
    crossWindowLockDisabled = true;
  }
  return async () => {};
}

/**
 * Acquire the cross-window lock. Returns a release function, which is a no-op
 * when the lock could not be acquired (timeout / fs unavailable) — in that
 * case the write proceeds under the in-window chain only, which degrades
 * multi-window safety but never blocks or fails a session write.
 */
async function acquireCrossWindowLock(): Promise<() => Promise<void>> {
  if (crossWindowLockDisabled) {
    return async () => {};
  }
  const lockPath = await resolveLockPath();
  if (lockPath === null) {
    return noteAcquireFailure();
  }
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  // Iterations where both mkdir and stat failed: either the holder released
  // between the two calls (a benign race — the next mkdir wins) or the
  // filesystem is unavailable. Two in a row means unavailable; bail fast
  // instead of spinning until the timeout.
  let probeFailures = 0;
  for (;;) {
    try {
      await mkdir(lockPath);
      consecutiveAcquireFailures = 0;
      return async () => {
        try {
          await remove(lockPath, { recursive: true });
        } catch {
          // Best effort; a leaked lock is broken as stale by the next writer.
        }
      };
    } catch {
      // Held by another window, or the filesystem is unavailable.
    }
    let heldSinceMs: number | null = null;
    try {
      const info = await stat(lockPath);
      heldSinceMs = info.mtime ? new Date(info.mtime).getTime() : 0;
    } catch {
      heldSinceMs = null;
    }
    if (heldSinceMs === null) {
      probeFailures += 1;
      if (probeFailures >= 2) {
        return noteAcquireFailure();
      }
      continue;
    }
    probeFailures = 0;
    if (Date.now() - heldSinceMs > LOCK_STALE_MS) {
      try {
        await remove(lockPath, { recursive: true });
      } catch {
        // Another window may have broken it first.
      }
      continue;
    }
    if (Date.now() >= deadline) {
      return noteAcquireFailure();
    }
    await sleep(LOCK_RETRY_DELAY_MS);
  }
}

/** Run `fn` exclusively against other session.json writers (all windows). */
export function withSessionWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const locked = async (): Promise<T> => {
    const release = await acquireCrossWindowLock();
    try {
      return await fn();
    } finally {
      await release();
    }
  };
  const run = writeChain.then(locked, locked);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Wait until all queued session writes have settled. */
export async function awaitSessionWriteLock(): Promise<void> {
  await writeChain;
}

/** Clears the write chain between unit tests. */
export function resetSessionWriteLockForTests(): void {
  writeChain = Promise.resolve();
  crossWindowLockDisabled = false;
  consecutiveAcquireFailures = 0;
}
