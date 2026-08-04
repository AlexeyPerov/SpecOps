/**
 * Serializes read-modify-write access to shared session-storage files.
 *
 * Two independent locks are exported (P03-08-03): one for `session.json` and
 * the incremental session records, one for `open-files.json`. They guard
 * disjoint files, so file opens (registry claims) no longer queue behind
 * session persistence — and a wedged writer in one domain cannot block the
 * other.
 *
 * Each lock has two layers (H29 — each webview is its own JS realm, so a
 * module-level promise chain only serializes writers *within* one window):
 *
 * 1. An in-window promise chain, guarded by a watchdog (P03-08-03): an entry
 *    that does not settle within {@link WRITE_CHAIN_WATCHDOG_MS} is surfaced
 *    to its caller as an error and the chain advances past it, so a single
 *    hung filesystem call can no longer permanently wedge every later write
 *    (previously: "files never open again until relaunch").
 * 2. A cross-window lock directory acquired inside the chain. `mkdir` is
 *    atomic — it fails if the directory exists — which makes it a portable
 *    mutex between windows. Stale locks (crashed window) are broken by age;
 *    if the filesystem is unavailable (unit tests, startup races) locking
 *    degrades to the in-window chain instead of failing the write.
 *
 * Ownership token (F12): the lock directory holds an `owner` file recording
 * which window + acquire id holds it. Before releasing or breaking the lock we
 * verify we still own it. Staleness is judged from the **owner file's** mtime
 * (P03-08-05): the heartbeat rewrites that file, and overwriting a file does
 * not update the parent directory's mtime, so judging the directory (as
 * before) made every hold longer than {@link LOCK_STALE_MS} look stale. The
 * heartbeat also re-verifies ownership before each refresh and stops itself
 * when the lock was taken over, so a broken-and-reacquired lock is never
 * clobbered or deleted by the previous holder.
 *
 * The acquire loop checks its deadline and a hard iteration cap on every
 * iteration, including the stale-break path (P03-08-01): a stale lock that
 * cannot actually be removed (EBUSY, permissions, another window recreating
 * it) used to bypass both the deadline and the retry sleep and spin forever,
 * saturating IPC and permanently wedging the write chain.
 *
 * Filesystem access goes through {@link resolveSessionFsOps} (P03-08-04):
 * async backend commands off the main thread when available, `tauri-plugin-fs`
 * otherwise.
 *
 * Callers that nest multiple session mutations must run them inside a single
 * {@link withSessionWriteLock} callback (use unlocked helpers), not nest
 * separate lock acquisitions — awaiting inside a lock would otherwise allow
 * unsafe re-entry.
 */

import { join } from "@tauri-apps/api/path";
import { ensureSpecOpsDataDir } from "./appDataDir";
import { logDiagnostic } from "./logging";
import { resolveSessionFsOps, resetSessionNativeFsForTests, type SessionFsOps } from "./sessionNativeFs";

const SESSION_LOCK_DIR_NAME = "session.json.lock";
const OPEN_FILE_REGISTRY_LOCK_DIR_NAME = "open-files.json.lock";
const LOCK_OWNER_FILE = "owner";
/** A holder older than this is assumed crashed and its lock is broken. */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_DELAY_MS = 40;
/** Give up waiting after this long and proceed with only the in-window chain. */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
/**
 * Hard cap on acquire-loop iterations (P03-08-01). The deadline is the real
 * limit; the cap is a backstop so no combination of clock changes and error
 * paths can turn the loop into a busy spin.
 */
const MAX_ACQUIRE_ITERATIONS = 500;
/** Consecutive acquire failures before cross-window locking is disabled. */
const MAX_ACQUIRE_FAILURES = 3;
/** Refresh the owner mtime this often while held, so a slow RMW is not misjudged stale. */
const LOCK_HEARTBEAT_INTERVAL_MS = 3_000;
/**
 * Stop refreshing the owner mtime after this long. A hold this long is not a
 * slow RMW — it is a hung operation (the watchdog fired long ago). Letting the
 * lock go stale allows other windows to break it instead of being locked out
 * indefinitely by a wedged holder.
 */
const LOCK_MAX_HEARTBEAT_REFRESH_MS = 60_000;
/**
 * A chained write that has not settled by now is treated as wedged: the caller
 * receives an error and the chain advances (P03-08-03). The underlying
 * operation is not cancelled — if it eventually completes, its own result is
 * simply unobserved.
 */
export const WRITE_CHAIN_WATCHDOG_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  fs: SessionFsOps,
  lockPath: string,
  owner: LockOwner,
): Promise<void> {
  const ownerPath = await join(lockPath, LOCK_OWNER_FILE);
  try {
    await fs.writeText(ownerPath, JSON.stringify(owner));
  } catch {
    // Best-effort: the mkdir already established ownership; the owner file is
    // consulted when present but its absence is handled (treated as a
    // crash-recovered lock judged solely by age).
  }
}

async function readOwnerFile(fs: SessionFsOps, lockPath: string): Promise<LockOwner | null> {
  const ownerPath = await join(lockPath, LOCK_OWNER_FILE);
  try {
    const raw = await fs.readText(ownerPath);
    const parsed = JSON.parse(raw) as Partial<LockOwner>;
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
 * Freshness timestamp of a held lock (ms since epoch): the owner file's mtime
 * when readable (the heartbeat refreshes that file — P03-08-05), else the lock
 * directory's mtime (owner file missing: crashed holder or pre-owner-write
 * window). `null` means the filesystem reports no mtime — treated as fresh so
 * such filesystems do not defeat cross-window exclusion.
 */
async function lockFreshnessMtimeMs(
  fs: SessionFsOps,
  lockPath: string,
): Promise<number | null> {
  try {
    const ownerPath = await join(lockPath, LOCK_OWNER_FILE);
    return await fs.statMtimeMs(ownerPath);
  } catch {
    // Owner file missing/unreadable — fall back to the directory itself.
  }
  return fs.statMtimeMs(lockPath);
}

interface CrossProcessWriteLock {
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * In-window-only serialization (P03-08-25): same FIFO chain as
   * {@link withLock} but skips the cross-window lock directory. See
   * `enqueueSessionWriteInWindow`.
   */
  enqueueInWindow<T>(fn: () => Promise<T>): Promise<T>;
  /** Wait until all currently queued writes have settled (or watchdogged). */
  flush(): Promise<void>;
  reset(): void;
}

function createCrossProcessWriteLock(lockDirName: string, label: string): CrossProcessWriteLock {
  let writeChain: Promise<void> = Promise.resolve();

  /**
   * Set after repeated environment failures (no Tauri IPC, data dir missing):
   * further writes skip the cross-window lock rather than paying the timeout on
   * every session write. The in-window chain still serializes local writers.
   */
  let crossWindowLockDisabled = false;
  let consecutiveAcquireFailures = 0;

  function noteAcquireFailure(): () => Promise<void> {
    consecutiveAcquireFailures += 1;
    if (consecutiveAcquireFailures >= MAX_ACQUIRE_FAILURES) {
      crossWindowLockDisabled = true;
    }
    return async () => {};
  }

  async function resolveLockPath(): Promise<string | null> {
    try {
      const dataDir = await ensureSpecOpsDataDir();
      return await join(dataDir, lockDirName);
    } catch {
      return null;
    }
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
    const fs = await resolveSessionFsOps();
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
    for (let iteration = 0; ; iteration += 1) {
      // P03-08-01: the deadline and a hard cap are checked at the top of every
      // iteration — no branch below (including the stale-break) can bypass
      // them, so acquisition always terminates.
      if (iteration > 0 && (Date.now() >= deadline || iteration >= MAX_ACQUIRE_ITERATIONS)) {
        return noteAcquireFailure();
      }
      try {
        await fs.mkdirExclusive(lockPath);
        consecutiveAcquireFailures = 0;
        await writeOwnerFile(fs, lockPath, self);
        // Heartbeat: refresh the owner file periodically while held so a slow
        // RMW is not misjudged stale by another window. Each beat re-verifies
        // ownership first (P03-08-05): once another window has broken and
        // reacquired the lock, this holder must neither overwrite the new
        // owner record nor delete the new lock on release.
        let lockLost = false;
        const heartbeat = setInterval(() => {
          void (async () => {
            if (Date.now() - self.acquiredAt > LOCK_MAX_HEARTBEAT_REFRESH_MS) {
              // A hold this long is a wedged operation, not a slow RMW. Stop
              // keeping the lock fresh so other windows can break it by age.
              clearInterval(heartbeat);
              return;
            }
            const current = await readOwnerFile(fs, lockPath);
            if (current !== null && !ownerIsSelf(current, self)) {
              lockLost = true;
              clearInterval(heartbeat);
              return;
            }
            await writeOwnerFile(fs, lockPath, self);
          })().catch(() => {});
        }, LOCK_HEARTBEAT_INTERVAL_MS);
        return async () => {
          clearInterval(heartbeat);
          if (lockLost) {
            // The lock was broken and reacquired by another window mid-RMW;
            // it is not ours to remove.
            return;
          }
          // Only remove the lock if we still own it. A slow RMW that got broken
          // by another window (or a crash-recovery break) must not delete the
          // *new* holder's lock — that was the silent mutual-exclusion loss.
          const current = await readOwnerFile(fs, lockPath);
          if (ownerIsSelf(current, self)) {
            try {
              await fs.remove(lockPath, { recursive: true });
            } catch {
              // Best effort; a leaked lock is broken as stale by the next writer.
            }
          }
        };
      } catch {
        // Held by another window, or the filesystem is unavailable.
      }
      let lockDirExists: boolean;
      try {
        await fs.statMtimeMs(lockPath);
        lockDirExists = true;
      } catch {
        lockDirExists = false;
      }
      if (!lockDirExists) {
        probeFailures += 1;
        if (probeFailures >= 2) {
          return noteAcquireFailure();
        }
        // Benign release race — retry mkdir after the standard delay (the
        // deadline check above still bounds the loop).
        await sleep(LOCK_RETRY_DELAY_MS);
        continue;
      }
      probeFailures = 0;
      const freshMtimeMs = await lockFreshnessMtimeMs(fs, lockPath).catch(() => null);
      // A filesystem that reports no mtime must not make every lock look
      // epoch-old (which would break it on every attempt and defeat
      // cross-window exclusion entirely). Treat a missing mtime as fresh.
      const heldSinceMs = freshMtimeMs ?? Date.now();
      const ageMs = Date.now() - heldSinceMs;
      if (ageMs > LOCK_STALE_MS) {
        // Before breaking, confirm the holder is not ourselves from a still-
        // in-flight acquisition (e.g. a duplicate-id path). Breaking our own
        // lock would let a third writer in mid-RMW.
        const owner = await readOwnerFile(fs, lockPath);
        if (ownerIsSelf(owner, self)) {
          // We hold it under a different acquisition record (shouldn't normally
          // happen since mkdir would have succeeded); leave it alone.
        } else {
          try {
            await fs.remove(lockPath, { recursive: true });
          } catch {
            // Another window may have broken it first. P03-08-01: fall through
            // to the shared sleep + deadline check — a lock that cannot be
            // removed must not turn this loop into an unbounded busy spin.
          }
        }
      }
      await sleep(LOCK_RETRY_DELAY_MS);
    }
  }

  /**
   * Watchdog (P03-08-03): reject the caller after {@link WRITE_CHAIN_WATCHDOG_MS}
   * while letting the chain advance. The wedged operation keeps running
   * unobserved; its eventual rejection (if any) is swallowed to avoid an
   * unhandled-rejection report for a promise no one can await anymore.
   */
  function guardWithWatchdog<T>(run: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        run.then(
          () => {},
          () => {},
        );
        void logDiagnostic({
          level: "error",
          source: "frontend",
          timestamp: new Date().toISOString(),
          message: `${label} write did not settle within ${WRITE_CHAIN_WATCHDOG_MS} ms; advancing the write queue`,
          metadata: { lockDirName, watchdogMs: WRITE_CHAIN_WATCHDOG_MS },
        }).catch(() => {});
        reject(
          new Error(
            `${label} write timed out after ${WRITE_CHAIN_WATCHDOG_MS} ms and was abandoned`,
          ),
        );
      }, WRITE_CHAIN_WATCHDOG_MS);
      run.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        (error: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    });
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const locked = async (): Promise<T> => {
      const release = await acquireCrossWindowLock();
      try {
        return await fn();
      } finally {
        await release();
      }
    };
    const previous = writeChain;
    // The watchdog must start when the entry begins *executing*, not when it
    // is queued — otherwise every entry queued behind a slow-but-legitimate
    // write would be falsely abandoned when the shared timer expired.
    const guarded = (async () => {
      await previous;
      return guardWithWatchdog(locked());
    })();
    writeChain = guarded.then(
      () => undefined,
      () => undefined,
    );
    return guarded;
  }

  /**
   * In-window-only serialization (P03-08-25): runs `fn` on the same FIFO
   * chain as {@link withLock} but skips the cross-window lock directory. For
   * per-window session files (navigation + buffer records) the only writer is
   * this window by construction, and the writes are atomic (temp + rename), so
   * the cross-window mkdir/owner/stat/remove IPC round-trips were pure cost.
   * The chain still orders per-window writes against each other and against
   * cross-window-locked writes (they share `writeChain`), and the watchdog
   * still applies, so a hung write cannot wedge later entries.
   */
  function enqueueInWindow<T>(fn: () => Promise<T>): Promise<T> {
    const previous = writeChain;
    const guarded = (async () => {
      await previous;
      return guardWithWatchdog(fn());
    })();
    writeChain = guarded.then(
      () => undefined,
      () => undefined,
    );
    return guarded;
  }

  return {
    withLock,
    enqueueInWindow,
    flush: async () => {
      await writeChain;
    },
    reset: () => {
      writeChain = Promise.resolve();
      crossWindowLockDisabled = false;
      consecutiveAcquireFailures = 0;
    },
  };
}

const sessionLock = createCrossProcessWriteLock(SESSION_LOCK_DIR_NAME, "session");
const openFileRegistryLock = createCrossProcessWriteLock(
  OPEN_FILE_REGISTRY_LOCK_DIR_NAME,
  "open-file registry",
);

/** Run `fn` exclusively against other session.json writers (all windows). */
export function withSessionWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  return sessionLock.withLock(fn);
}

/**
 * Run `fn` on the session write chain without acquiring the cross-window lock
 * (P03-08-25). Use for per-window session files whose only writer is this
 * window; see {@link CrossProcessWriteLock.enqueueInWindow}.
 */
export function enqueueSessionWriteInWindow<T>(fn: () => Promise<T>): Promise<T> {
  return sessionLock.enqueueInWindow(fn);
}

/**
 * Run `fn` exclusively against other `open-files.json` writers (all windows).
 *
 * Separate from {@link withSessionWriteLock} (P03-08-03): the registry and the
 * session snapshot are disjoint files, and serializing file opens behind
 * session persistence made every open pay for unrelated writes — and made a
 * wedged persistence write block opens forever.
 */
export function withOpenFileRegistryLock<T>(fn: () => Promise<T>): Promise<T> {
  return openFileRegistryLock.withLock(fn);
}

/** Wait until all queued session and registry writes have settled. */
export async function awaitSessionWriteLock(): Promise<void> {
  await Promise.all([sessionLock.flush(), openFileRegistryLock.flush()]);
}

/** Clears the write chains between unit tests. */
export function resetSessionWriteLockForTests(): void {
  sessionLock.reset();
  openFileRegistryLock.reset();
  resetSessionNativeFsForTests();
}
