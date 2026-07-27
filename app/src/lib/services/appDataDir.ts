import { mkdir } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

let ready: Promise<string> | null = null;

/** Ensures `appDataDir()/spec-ops` exists; returns that directory path. */
export function ensureSpecOpsDataDir(): Promise<string> {
  if (!ready) {
    const pending = (async () => {
      const base = await appDataDir();
      const dir = await join(base, "spec-ops");
      await mkdir(dir, { recursive: true });
      return dir;
    })();
    ready = pending;
    // A transient mkdir/appDataDir failure must not poison every settings /
    // session / theme read for the process lifetime. Clear the cache so the
    // next caller retries.
    void pending.catch(() => {
      if (ready === pending) {
        ready = null;
      }
    });
  }
  return ready;
}

/** Test-only: drop the cached promise so the next call re-runs mkdir. */
export function resetSpecOpsDataDirForTests(): void {
  ready = null;
}
