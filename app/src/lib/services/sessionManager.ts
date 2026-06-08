import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { ensureSpecOpsDataDir } from "./appDataDir";
import type {
  AppDomainState,
  AppSessionSnapshot,
  RestoredWindowSession,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { logDiagnostic } from "./logging";
import { getErrorMessage } from "../commands/commandErrors";
import {
  dedupeWindowSnapshotAgainstRegistry,
  syncOpenFileRegistryForWindow,
} from "./openFileRegistry";
import {
  createEmptySessionSnapshot,
  decodeSessionSnapshot,
  encodeSessionSnapshot,
  toWindowSnapshot,
} from "./sessionSnapshotCodec";
import { nextNumericId, sanitizeWindowSnapshot } from "./sessionSnapshotSanitizer";
export { nextNumericId, sanitizeWindowSnapshot };

const SESSION_FILE = "session.json";
const SESSION_BACKUP_FILE = "session.backup.json";

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Clears debounce timer between unit tests. */
export function resetSessionManagerForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
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

async function writeSessionSnapshot(current: AppSessionSnapshot): Promise<void> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  const backupPath = await getSessionPath(SESSION_BACKUP_FILE);
  const content = encodeSessionSnapshot(current);
  await writeTextFile(sessionPath, content);
  await writeTextFile(backupPath, content);
}

export async function persistGlobalRecentFiles(recentFiles: string[]): Promise<void> {
  const current = await readSessionSnapshot();
  current.recentFiles = recentFiles;
  current.updatedAt = new Date().toISOString();
  await writeSessionSnapshot(current);
}

export async function persistSessionSnapshot(
  state: AppDomainState,
  windowId: string,
): Promise<void> {
  const current = await readSessionSnapshot();

  current.windows[windowId] = toWindowSnapshot(state);
  current.lastActiveWindowId = windowId;
  current.updatedAt = new Date().toISOString();

  await writeSessionSnapshot(current);

  await syncOpenFileRegistryForWindow(windowId, state);

  await logDiagnostic({
    level: "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "session snapshot persisted",
    metadata: { windowId },
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
    return restoreWindowSessionFromSnapshot(windowId, parsed);
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
    return restoreWindowSessionFromSnapshot(windowId, parsed);
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
    void persistSessionSnapshot(state, windowId);
  }, 1200);
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

export async function updateLastActiveWindow(windowId: string): Promise<void> {
  const current = await readSessionSnapshot();
  current.lastActiveWindowId = windowId;
  current.updatedAt = new Date().toISOString();
  await writeSessionSnapshot(current);
}

export { nextNumericId, sanitizeWindowSnapshot } from "./sessionSnapshotSanitizer";
