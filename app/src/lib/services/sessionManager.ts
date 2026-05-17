import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import type {
  AppDomainState,
  AppSessionSnapshot,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { logDiagnostic } from "./logging";

const SESSION_FILE = "session.json";
const SESSION_BACKUP_FILE = "session.backup.json";

let persistTimer: ReturnType<typeof setTimeout> | null = null;

async function getSessionPath(fileName: string): Promise<string> {
  const dataDir = await appDataDir();
  return join(dataDir, "spec-ops", fileName);
}

function toWindowSnapshot(state: AppDomainState): WindowSessionSnapshot {
  return {
    documents: state.documents,
    session: state.session,
    recentFiles: state.recentFiles,
    editor: state.editor,
  };
}

export async function persistSessionSnapshot(
  state: AppDomainState,
  windowId: string,
): Promise<void> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  const backupPath = await getSessionPath(SESSION_BACKUP_FILE);

  let current: AppSessionSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: windowId,
    windows: {},
  };

  try {
    const raw = await readTextFile(sessionPath);
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version === 1 && parsed.windows) {
      current = parsed;
    }
  } catch {
    // first save / no session file
  }

  current.windows[windowId] = toWindowSnapshot(state);
  current.lastActiveWindowId = windowId;
  current.updatedAt = new Date().toISOString();

  const content = JSON.stringify(current, null, 2);
  await writeTextFile(sessionPath, content);
  await writeTextFile(backupPath, content);

  await logDiagnostic({
    level: "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "session snapshot persisted",
    metadata: { windowId },
  });
}

export async function restoreWindowSession(
  windowId: string,
): Promise<WindowSessionSnapshot | null> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  const backupPath = await getSessionPath(SESSION_BACKUP_FILE);

  try {
    const raw = await readTextFile(sessionPath);
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version !== 1 || !parsed.windows) {
      return null;
    }
    return parsed.windows[windowId] ?? null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
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
    const parsed = JSON.parse(backupRaw) as AppSessionSnapshot;
    if (parsed.version !== 1 || !parsed.windows) {
      return null;
    }
    await logDiagnostic({
      level: "info",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "session restored from backup",
      metadata: { windowId },
    });
    return parsed.windows[windowId] ?? null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
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
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version !== 1 || !parsed.lastActiveWindowId) {
      return null;
    }
    return parsed.lastActiveWindowId;
  } catch {
    return null;
  }
}

export async function updateLastActiveWindow(windowId: string): Promise<void> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  let current: AppSessionSnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: windowId,
    windows: {},
  };

  try {
    const raw = await readTextFile(sessionPath);
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version === 1 && parsed.windows) {
      current = parsed;
    }
  } catch {
    // no existing session file yet
  }

  current.lastActiveWindowId = windowId;
  current.updatedAt = new Date().toISOString();
  await writeTextFile(sessionPath, JSON.stringify(current, null, 2));
}
