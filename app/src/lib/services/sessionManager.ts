import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { ensureSpecOpsDataDir } from "./appDataDir";
import type {
  AppDomainState,
  AppSessionSnapshot,
  RestoredWindowSession,
} from "../domain/contracts";
import { logDiagnostic } from "./logging";
import { getErrorMessage } from "../commands/commandErrors";
import {
  dedupeWindowSnapshotAgainstRegistry,
  syncOpenFileRegistryForWindowUnlocked,
} from "./openFileRegistry";
import {
  createEmptySessionSnapshot,
  decodeSessionSnapshot,
  encodeSessionSnapshot,
  toWindowSnapshot,
} from "./sessionSnapshotCodec";
import { nextNumericId, sanitizeWindowSnapshot } from "./sessionSnapshotSanitizer";
import {
  awaitSessionWriteLock,
  resetSessionWriteLockForTests,
  withSessionWriteLock,
} from "./sessionWriteLock";
export { nextNumericId, sanitizeWindowSnapshot };

const SESSION_FILE = "session.json";
const SESSION_BACKUP_FILE = "session.backup.json";

/**
 * When true, a brand-new window with no `windows[windowId]` entry restores a
 * copy of the last-active window's tabs. Default is false: new windows start
 * empty (app shell bootstrap untitled / notepad).
 */
export const DUPLICATE_LAST_SESSION_ON_NEW_WINDOW = false;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let tabsChangedFlushHandler: ((state: AppDomainState) => void) | null = null;

/** Registers immediate session persist when open tabs change (e.g. tab close). */
export function registerTabsChangedSessionFlush(handler: (state: AppDomainState) => void): void {
  tabsChangedFlushHandler = handler;
}

/** Clears tab-change flush registration (tests). */
export function resetTabsChangedSessionFlushForTests(): void {
  tabsChangedFlushHandler = null;
}

export function notifyTabsChangedForSession(state: AppDomainState): void {
  tabsChangedFlushHandler?.(state);
}

/** Clears debounce timer between unit tests. */
export function resetSessionManagerForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  resetTabsChangedSessionFlushForTests();
  resetSessionWriteLockForTests();
}

async function getSessionPath(fileName: string): Promise<string> {
  const dataDir = await ensureSpecOpsDataDir();
  return join(dataDir, fileName);
}

async function readSessionSnapshot(): Promise<AppSessionSnapshot> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  try {
    const raw = await readTextFile(sessionPath);
    const decoded = decodeSessionSnapshot(raw);
    if (decoded) {
      return decoded;
    }
  } catch {
    // first save / no session file
  }
  return createEmptySessionSnapshot();
}

async function writeSessionSnapshot(
  current: AppSessionSnapshot,
  options?: { skipBackup?: boolean },
): Promise<void> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  const content = encodeSessionSnapshot(current);
  await writeTextFile(sessionPath, content);
  if (options?.skipBackup) {
    return;
  }
  const backupPath = await getSessionPath(SESSION_BACKUP_FILE);
  await writeTextFile(backupPath, content);
}

export async function persistGlobalRecentFiles(recentFiles: string[]): Promise<void> {
  await withSessionWriteLock(async () => {
    const current = await readSessionSnapshot();
    current.recentFiles = recentFiles;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current);
  });
}

export async function persistSessionSnapshot(
  state: AppDomainState,
  windowId: string,
): Promise<void> {
  await withSessionWriteLock(async () => {
    const current = await readSessionSnapshot();
    const stampedAt = new Date().toISOString();

    current.windows[windowId] = {
      ...toWindowSnapshot(state),
      updatedAt: stampedAt,
    };
    current.lastActiveWindowId = windowId;
    current.updatedAt = stampedAt;

    await writeSessionSnapshot(current);

    await syncOpenFileRegistryForWindowUnlocked(windowId, state);

    await logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "session snapshot persisted",
      metadata: { windowId },
    });
  });
}

async function restoreWindowSessionFromSnapshot(
  windowId: string,
  parsed: AppSessionSnapshot,
): Promise<RestoredWindowSession | null> {
  if (parsed.version !== 2 || !parsed.windows) {
    return null;
  }
  const snapshot = parsed.windows[windowId];
  if (!snapshot) {
    return null;
  }
  const deduped = await dedupeWindowSnapshotAgainstRegistry(windowId, snapshot);
  const sanitized = await sanitizeWindowSnapshot(deduped);
  return {
    snapshot: sanitized,
    recentFiles: parsed.recentFiles ?? [],
  };
}

/**
 * Restore this window's session entry. When `windowId` is absent from
 * `parsed.windows`, returns null (empty editor) unless
 * {@link DUPLICATE_LAST_SESSION_ON_NEW_WINDOW} is enabled.
 */
export async function restoreWindowSession(
  windowId: string,
): Promise<RestoredWindowSession | null> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  const backupPath = await getSessionPath(SESSION_BACKUP_FILE);

  try {
    const raw = await readTextFile(sessionPath);
    const parsed = decodeSessionSnapshot(raw);
    if (!parsed) {
      return null;
    }
    const direct = await restoreWindowSessionFromSnapshot(windowId, parsed);
    if (direct) {
      return direct;
    }
    if (
      DUPLICATE_LAST_SESSION_ON_NEW_WINDOW &&
      parsed.lastActiveWindowId &&
      parsed.lastActiveWindowId !== windowId
    ) {
      return restoreWindowSessionFromSnapshot(parsed.lastActiveWindowId, parsed);
    }
    return null;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await logDiagnostic({
      level: "warn",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "session restore failed, trying backup",
      metadata: { windowId, reason: message },
    });
  }

  try {
    const backupRaw = await readTextFile(backupPath);
    const parsed = decodeSessionSnapshot(backupRaw);
    if (!parsed) {
      return null;
    }
    await logDiagnostic({
      level: "info",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "session restored from backup",
      metadata: { windowId },
    });
    const direct = await restoreWindowSessionFromSnapshot(windowId, parsed);
    if (direct) {
      return direct;
    }
    if (
      DUPLICATE_LAST_SESSION_ON_NEW_WINDOW &&
      parsed.lastActiveWindowId &&
      parsed.lastActiveWindowId !== windowId
    ) {
      return restoreWindowSessionFromSnapshot(parsed.lastActiveWindowId, parsed);
    }
    return null;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    await logDiagnostic({
      level: "error",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "session backup restore failed",
      metadata: { windowId, reason: message },
    });
    return null;
  }
}

export function scheduleSessionPersistence(
  state: AppDomainState,
  windowId: string,
): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistSessionSnapshot(state, windowId);
  }, 1200);
}

export async function flushSessionPersistence(
  state: AppDomainState,
  windowId: string,
): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistSessionSnapshot(state, windowId);
  await awaitSessionWriteLock();
}

export async function getLastActiveWindowId(): Promise<string | null> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  try {
    const raw = await readTextFile(sessionPath);
    const parsed = decodeSessionSnapshot(raw);
    if (!parsed?.lastActiveWindowId) {
      return null;
    }
    return parsed.lastActiveWindowId;
  } catch {
    return null;
  }
}

export async function updateLastActiveWindow(
  windowId: string,
  options?: { skipBackup?: boolean },
): Promise<void> {
  await withSessionWriteLock(async () => {
    const current = await readSessionSnapshot();
    current.lastActiveWindowId = windowId;
    current.updatedAt = new Date().toISOString();
    await writeSessionSnapshot(current, options);
  });
}
