/**
 * Session-storage filesystem adapter (P03-08-04).
 *
 * The `tauri-plugin-fs` commands used by the session write lock and atomic
 * session writes (`mkdir`, `stat`, `remove`, `rename`, `writeTextFile`) are
 * synchronous Tauri commands: they execute inline on the main/IPC thread, so a
 * contended lock-acquire spin or a large atomic write competes directly with
 * the UI. This module prefers project-owned async Rust commands
 * (`session_fs_*`, `spawn_blocking` on the backend) and falls back to the
 * plugin implementations when the native commands are unavailable (unit tests,
 * older backends), keeping behavior identical in both modes.
 *
 * The native commands are scoped on the Rust side to the SpecOps app-data
 * directory, so they cannot be used as a general filesystem primitive from the
 * webview — out-of-scope paths are rejected and callers must use the
 * scope-checked plugin path instead.
 */

import { invoke } from "@tauri-apps/api/core";
import { mkdir, readFile, remove, stat, writeFile } from "@tauri-apps/plugin-fs";
import { ensureSpecOpsDataDir } from "./appDataDir";

export interface SessionFsOps {
  /** Create `path` as a directory; rejects when it already exists (mutex mkdir). */
  mkdirExclusive(path: string): Promise<void>;
  /** Modification time in ms since epoch, `null` when the fs reports no mtime; rejects when missing. */
  statMtimeMs(path: string): Promise<number | null>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Write a small UTF-8 text file (lock owner records). */
  writeText(path: string, content: string): Promise<void>;
  /** Read a small UTF-8 text file (lock owner records); rejects when missing. */
  readText(path: string): Promise<string>;
}

let supportProbe: Promise<boolean> | null = null;

/** Whether the async `session_fs_*` backend commands are available. */
export function nativeSessionFsSupported(): Promise<boolean> {
  if (!supportProbe) {
    supportProbe = (async () => {
      try {
        return (await invoke<boolean>("session_fs_supported")) === true;
      } catch {
        // No Tauri IPC (tests) or an older backend without the commands.
        return false;
      }
    })();
  }
  return supportProbe;
}

const nativeOps: SessionFsOps = {
  mkdirExclusive: (path) => invoke("session_fs_mkdir", { path }),
  statMtimeMs: (path) => invoke<number | null>("session_fs_stat_mtime_ms", { path }),
  remove: (path, options) =>
    invoke("session_fs_remove", { path, recursive: options?.recursive ?? false }),
  writeText: (path, content) => invoke("session_fs_write_text", { path, content }),
  readText: (path) => invoke<string>("session_fs_read_text", { path }),
};

const pluginOps: SessionFsOps = {
  mkdirExclusive: (path) => mkdir(path),
  statMtimeMs: async (path) => {
    const info = await stat(path);
    return info.mtime ? new Date(info.mtime).getTime() : null;
  },
  remove: (path, options) => remove(path, options),
  // Owner records deliberately use the binary plugin APIs (as the lock always
  // has): they are internal bookkeeping, best-effort by contract, and must not
  // surface through `writeTextFile`/`readTextFile` (session-content APIs that
  // tests and instrumentation observe).
  writeText: (path, content) => writeFile(path, new TextEncoder().encode(content)),
  readText: async (path) => new TextDecoder().decode(await readFile(path)),
};

export async function resolveSessionFsOps(): Promise<SessionFsOps> {
  return (await nativeSessionFsSupported()) ? nativeOps : pluginOps;
}

/**
 * Atomic temp-file + rename write executed entirely in the Rust backend: one
 * async IPC call instead of 2–4 synchronous main-thread plugin calls.
 */
export function nativeAtomicWriteTextFile(path: string, content: string): Promise<void> {
  return invoke("session_fs_atomic_write_text", { path, content });
}

let cachedDataDir: string | null = null;
let dataDirRequested = false;

/**
 * Synchronous view of the SpecOps data dir once it has resolved. Returns
 * `null` (and kicks off resolution) until then — callers treat `null` as
 * "not session storage" and use the plugin path.
 */
export function cachedSessionStorageDir(): string | null {
  if (!dataDirRequested) {
    dataDirRequested = true;
    void ensureSpecOpsDataDir()
      .then((dir) => {
        cachedDataDir = dir;
      })
      .catch(() => {
        dataDirRequested = false;
      });
  }
  return cachedDataDir;
}

/** Whether `path` is inside the resolved session-storage (app data) directory. */
export function isSessionStoragePath(path: string): boolean {
  const dir = cachedSessionStorageDir();
  if (dir === null) {
    return false;
  }
  const separator = dir.includes("\\") ? "\\" : "/";
  const prefix = dir.endsWith(separator) ? dir : `${dir}${separator}`;
  return path.startsWith(prefix);
}

export function resetSessionNativeFsForTests(): void {
  supportProbe = null;
  cachedDataDir = null;
  dataDirRequested = false;
}
