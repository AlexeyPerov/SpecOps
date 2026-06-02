import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { ensureSpecOpsDataDir } from "./appDataDir";
import type {
  AppDomainState,
  AppSessionSnapshot,
  DocumentState,
  RestoredWindowSession,
  TabState,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { createFileTab, isAgentTab, isFileTab, normalizeTabState } from "../domain/contracts";
import { normalizeSessionState } from "./workspaceAgentSession";
import { logDiagnostic } from "./logging";
import { getErrorMessage } from "../commands/commandErrors";
import { emptyUnsavedDocumentTitle } from "./untitledDocument";
import {
  dedupeWindowSnapshotAgainstRegistry,
  syncOpenFileRegistryForWindow,
} from "./openFileRegistry";
import {
  refreshDocumentFromDiskIfNeeded,
  stripWindowSnapshotForSession,
} from "./sessionDocumentPersistence";

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

function toWindowSnapshot(state: AppDomainState): WindowSessionSnapshot {
  return stripWindowSnapshotForSession({
    activeContextId: state.contexts.activeContextId,
    notepad: state.contexts.notepad,
    workspaces: state.contexts.workspaces,
    editorPreferences: {
      zoomPercent: state.editor.zoomPercent,
      wrapLines: state.editor.wrapLines,
    },
  });
}

function emptySessionSnapshot(): AppSessionSnapshot {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: "main",
    openFileRegistry: {},
    recentFiles: [],
    windows: {},
  };
}

async function readSessionSnapshot(): Promise<AppSessionSnapshot> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  try {
    const raw = await readTextFile(sessionPath);
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version === 2 && parsed.windows) {
      return {
        ...emptySessionSnapshot(),
        ...parsed,
        openFileRegistry: parsed.openFileRegistry ?? {},
        recentFiles: parsed.recentFiles ?? [],
      };
    }
  } catch {
    // first save / no session file
  }
  return emptySessionSnapshot();
}

async function writeSessionSnapshot(current: AppSessionSnapshot): Promise<void> {
  const sessionPath = await getSessionPath(SESSION_FILE);
  const backupPath = await getSessionPath(SESSION_BACKUP_FILE);
  const content = JSON.stringify(current, null, 2);
  await writeTextFile(sessionPath, content);
  await writeTextFile(backupPath, content);
}

function buildFallbackDocument(documentId: string): DocumentState {
  return {
    id: documentId,
    filePath: null,
    title: emptyUnsavedDocumentTitle(),
    content: "",
    savedContent: "",
    isDirty: false,
    contentKind: "text",
    language: "plaintext",
    encoding: "utf-8",
    lineEnding: "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
  };
}

export function nextNumericId(prefix: "doc" | "tab", ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    const value = Number(id.replace(`${prefix}-`, ""));
    if (Number.isFinite(value) && value > 0) {
      max = Math.max(max, value);
    }
  }
  return `${prefix}-${Math.max(1, max + 1)}`;
}

function isFileMissingError(error: unknown): boolean {
  const message = getErrorMessage(error, String(error));
  const lower = message.toLowerCase();
  return (
    lower.includes("no such file") ||
    lower.includes("not found") ||
    lower.includes("os error 2") ||
    lower.includes("cannot find the path")
  );
}

async function fileStillExists(path: string): Promise<boolean> {
  try {
    await readTextFile(path);
    return true;
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      return false;
    }
    return true;
  }
}

function normalizeRestoredDocument(documentState: DocumentState): DocumentState {
  return {
    ...documentState,
    diskFingerprint: documentState.diskFingerprint ?? null,
    dismissedFingerprint: documentState.dismissedFingerprint ?? null,
    fileMissing: documentState.fileMissing ?? false,
    scrollTop: documentState.scrollTop ?? 0,
    markdownViewMode:
      documentState.markdownViewMode === "split" || documentState.markdownViewMode === "preview"
        ? documentState.markdownViewMode
        : "edit",
    contentKind:
      documentState.contentKind === "image" || documentState.contentKind === "binary"
        ? documentState.contentKind
        : "text",
  };
}

export async function sanitizeWindowSnapshot(
  snapshot: WindowSessionSnapshot,
): Promise<WindowSessionSnapshot> {
  async function sanitizeContext(context: WindowSessionSnapshot["notepad"]): Promise<WindowSessionSnapshot["notepad"]> {
    const documentsById = new Map(
      await Promise.all(
        context.documents.map(async (documentState) => {
          const normalized = normalizeRestoredDocument(documentState);
          const refreshed = await refreshDocumentFromDiskIfNeeded(
            normalized,
            isFileMissingError,
          );
          return [documentState.id, refreshed] as const;
        }),
      ),
    );
    const openTabs: TabState[] = [];

    for (const rawTab of context.session.openTabs) {
      const tab = normalizeTabState(rawTab);
      if (isAgentTab(tab)) {
        openTabs.push(tab);
        continue;
      }
      const linkedDocument = documentsById.get(tab.documentId);
      if (!linkedDocument) {
        continue;
      }
      if (linkedDocument.filePath) {
        const exists = await fileStillExists(linkedDocument.filePath);
        if (!exists) {
          documentsById.set(tab.documentId, {
            ...linkedDocument,
            fileMissing: true,
          });
        }
      }
      openTabs.push(tab);
    }

    if (openTabs.length === 0) {
      const docId = nextNumericId(
        "doc",
        context.documents.map((documentState) => documentState.id),
      );
      const tabId = nextNumericId(
        "tab",
        context.session.openTabs.map((tab) => tab.id),
      );
      const fallbackDocument = buildFallbackDocument(docId);
      return {
        documents: [fallbackDocument],
        session: normalizeSessionState({
          ...context.session,
          openTabs: [createFileTab(tabId, docId)],
          selectedTabId: tabId,
          windowBounds: context.session.windowBounds ?? null,
        }),
      };
    }

    const referencedDocIds = new Set(
      openTabs.filter(isFileTab).map((tab) => tab.documentId),
    );
    const documents = [...documentsById.values()].filter((documentState) =>
      referencedDocIds.has(documentState.id),
    );
    const selectedTabId = openTabs.some((tab) => tab.id === context.session.selectedTabId)
      ? context.session.selectedTabId
      : openTabs[0]?.id ?? null;

    return {
      documents,
      session: normalizeSessionState({
        ...context.session,
        openTabs,
        selectedTabId,
        windowBounds: context.session.windowBounds ?? null,
      }),
    };
  }

  const notepad = await sanitizeContext(snapshot.notepad);
  const workspaces = [];
  for (const workspace of snapshot.workspaces) {
    workspaces.push({
      ...workspace,
      snapshot: await sanitizeContext(workspace.snapshot),
    });
  }
  const activeContextId =
    snapshot.activeContextId === "notepad" ||
    workspaces.some((workspace) => workspace.id === snapshot.activeContextId)
      ? snapshot.activeContextId
      : "notepad";

  return {
    ...snapshot,
    activeContextId,
    notepad,
    workspaces,
  };
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
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
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
    const parsed = JSON.parse(backupRaw) as AppSessionSnapshot;
    if (parsed.version !== 2 || !parsed.windows) {
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
    const parsed = JSON.parse(raw) as AppSessionSnapshot;
    if (parsed.version !== 2 || !parsed.lastActiveWindowId) {
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
