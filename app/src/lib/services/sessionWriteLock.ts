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
 * Ownership token (F12): the lock directory holds an `owner` file recording
 * which window + acquire id holds it. Before releasing or breaking the lock we
 * verify we still own it — a legitimately slow RMW (>10 s: network volume,
 * paused debugger) used to look stale and get broken, after which the original
 * holder's `release()` deleted the *new* holder's lock, silently losing mutual
 * exclusion. The token also carries an mtime that is refreshed while held, and
 * a filesystem reporting no mtime is treated as fresh rather than epoch-old.
 *
 * Callers that nest multiple session mutations must run them inside a single
 * {@link withSessionWriteLock} callback (use unlocked helpers), not nest
 * separate lock acquisitions — awaiting inside a lock would otherwise allow
 * unsafe re-entry.
 */

import { mkdir, readFile, remove, stat, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { ensureSpecOpsDataDir } from "./appDataDir";

const LOCK_DIR_NAME = "session.json.lock";
const LOCK_OWNER_FILE = "owner";
/** A holder older than this is assumed crashed and its lock is broken. */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 40;
/** Give up waiting after this long and proceed with only the in-window chain. */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
/** Consecutive acquire failures before cross-window locking is disabled. */
const MAX_ACQUIRE_FAILURES = 3;
/** Refresh the owner mtime this often while held, so a slow RMW is not misjudged stale. */
const LOCK_HEARTBEAT_INTERVAL_MS = 3_000;

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
 * A per-acquire identity written into the lock dir so release/stale-break can
 * verify ownership. `windowId` identifies the holder; `acquireId` is unique per
 * acquisition so two successive acquisitions by the same window are not
 * confused.
 */
interface LockOwner {
  windowId: string;
  acquireId: string;
  acquiredAt: number;
}

function thisWindowId(): string {
  // Each webview is its own realm; the label is the stable cross-window id.
  // The Tauri API is read synchronously off the global scope and can throw in
  // non-Tauri environments (jsdom tests), so guard it.
  try {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    };
    const label = w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (label) {
      return label;
    }
  } catch {
    // ignore — fall through to the per-realm id
  }
  return "unknown-window";
}

function mintAcquireId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function writeOwnerFile(
  lockPath: string,
  owner: LockOwner,
): Promise<void> {
  const ownerPath = await join(lockPath, LOCK_OWNER_FILE);
  try {
    await writeFile(ownerPath, new TextEncoder().encode(JSON.stringify(owner)));
  } catch {
    // Best-effort: the mkdir already established ownership; the owner file is
    // consulted when present but its absence is handled (treated as a
    // crash-recovered lock judged solely by age).
  }
}

async function readOwnerFile(lockPath: string): Promise<LockOwner | null> {
  const ownerPath = await join(lockPath, LOCK_OWNER_FILE);
  try {
    const bytes = await readFile(ownerPath);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LockOwner>;
    if (
      typeof parsed.windowId === "string" &&
      typeof parsed.acquireId === "string" &&
      typeof parsed.acquiredAt === "number"
    ) {
      return {
        windowId: parsed.windowId,
        acquireId: parsed.acquireId,
        acquiredAt: parsed.acquiredAt,
      };
    }
  } catch {
    // Missing or unreadable owner file — caller falls back to age-based break.
  }
  return null;
}

/**
 * Whether `owner` still belongs to `self`. Same window + same acquire id means
 * the slow RMW is still ours and must not be broken or released by anyone else.
 */
function ownerIsSelf(owner: LockOwner | null, self: LockOwner): boolean {
  return Boolean(
    owner &&
      owner.windowId === self.windowId &&
      owner.acquireId === self.acquireId,
  );
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
  const self: LockOwner = {
    windowId: thisWindowId(),
    acquireId: mintAcquireId(),
    acquiredAt: Date.now(),
  };
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
      await writeOwnerFile(lockPath, self);
      // Heartbeat: refresh the owner mtime periodically while held so a slow
      // RMW is not misjudged stale by another window. The interval is cleared
      // on release.
      const heartbeat = setInterval(() => {
        void writeOwnerFile(lockPath, self).catch(() => {});
      }, LOCK_HEARTBEAT_INTERVAL_MS);
      return async () => {
        clearInterval(heartbeat);
        // Only remove the lock if we still own it. A slow RMW that got broken
        // by another window (or a crash-recovery break) must not delete the
        // *new* holder's lock — that was the silent mutual-exclusion loss.
        const current = await readOwnerFile(lockPath);
        if (ownerIsSelf(current, self)) {
          try {
            await remove(lockPath, { recursive: true });
          } catch {
            // Best effort; a leaked lock is broken as stale by the next writer.
          }
        }
      };
    } catch {
      // Held by another window, or the filesystem is unavailable.
    }
    let info;
    try {
      info = await stat(lockPath);
    } catch {
      info = null;
    }
    if (info === null) {
      probeFailures += 1;
      if (probeFailures >= 2) {
        return noteAcquireFailure();
      }
      continue;
    }
    probeFailures = 0;
    // A filesystem that reports no mtime must not make every lock look
    // epoch-old (which would break it on every attempt and defeat cross-window
    // exclusion entirely). Treat a missing mtime as fresh.
    const heldSinceMs = info.mtime ? new Date(info.mtime).getTime() : Date.now();
    const ageMs = Date.now() - heldSinceMs;
    if (ageMs > LOCK_STALE_MS) {
      // Before breaking, confirm the holder is not ourselves from a still-
      // in-flight acquisition (e.g. a duplicate-id path). Breaking our own
      // lock would let a third writer in mid-RMW.
      const owner = await readOwnerFile(lockPath);
      if (ownerIsSelf(owner, self)) {
        // We hold it under a different acquisition record (shouldn't normally
        // happen since mkdir would have succeeded); leave it alone.
      } else {
        try {
          await remove(lockPath, { recursive: true });
        } catch {
          // Another window may have broken it first.
        }
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
