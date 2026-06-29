import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appState } from "../state/appState";
import type { ContextId, DiskFingerprint } from "../domain/contracts";
import { getSessionTabs, isFileTab, normalizeTabState } from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import {
  claimOpenFile,
  readOpenFileRegistry,
} from "./openFileRegistry";
import {
  initializeDocumentDiskState,
} from "./externalFileChanges";
import type { FileContentKind } from "./fileContentKind";
import type { OpenedFile } from "./fileSystem";
import { openPath } from "./fileSystem";
import {
  WINDOW_EVENT_SELECT_TAB_FOR_PATH,
} from "./windowManager";
import { ensureNotepadForOutsidePath, isPathUnderRoot } from "./workspacePaths";

export type RequestOpenPathResult =
  | { kind: "redirected"; path: string; ownerWindowId: string }
  | { kind: "existing"; path: string; documentId: string }
  | { kind: "needs_read"; path: string; switchedToNotepad: boolean };

function findLocalDocumentForNormalizedPath(
  normalizedPath: string,
): { contextId: ContextId; documentId: string } | null {
  const snapshot = appState.getSnapshot();
  const contexts = [
    { id: "notepad" as const, snapshot: snapshot.contexts.notepad },
    ...snapshot.contexts.workspaces.map((workspace) => ({
      id: workspace.id,
      snapshot: workspace.snapshot,
    })),
  ];

  for (const context of contexts) {
    for (const tab of getSessionTabs(context.snapshot.session)) {
      if (!isFileTab(tab)) {
        continue;
      }
      const documentState = context.snapshot.documents.find((doc) => doc.id === tab.documentId);
      if (
        documentState?.filePath &&
        normalizePathSync(documentState.filePath) === normalizedPath
      ) {
        return { contextId: context.id, documentId: documentState.id };
      }
    }
  }

  return null;
}

export async function requestOpenPath(
  path: string,
  windowId: string,
): Promise<RequestOpenPathResult> {
  const outsideRouting = ensureNotepadForOutsidePath(path);
  const normalized = normalizePathSync(path);
  const registry = await readOpenFileRegistry();
  const owner = registry[normalized];

  if (owner && owner.windowId !== windowId) {
    await redirectToOwnerWindow(normalized, owner.windowId);
    return { kind: "redirected", path: normalized, ownerWindowId: owner.windowId };
  }

  const activeContextId = appState.getSnapshot().contexts.activeContextId;
  const activeWorkspaceRoot = appState.getWorkspaceRoot();
  if (
    activeWorkspaceRoot &&
    activeContextId !== "notepad" &&
    isPathUnderRoot(path, activeWorkspaceRoot)
  ) {
    const migratedDocumentId = appState.migrateNotepadFileTabToWorkspace(
      normalized,
      activeContextId,
    );
    if (migratedDocumentId) {
      appState.touchRecentFile(path);
      await claimOpenFile(path, windowId, migratedDocumentId);
      return { kind: "existing", path: normalized, documentId: migratedDocumentId };
    }
  }

  const existingLocal = findLocalDocumentForNormalizedPath(normalized);
  if (existingLocal) {
    appState.switchContext(existingLocal.contextId);
    appState.selectOrReopenTabForDocument(existingLocal.documentId);
    appState.touchRecentFile(path);
    await claimOpenFile(path, windowId, existingLocal.documentId);
    return { kind: "existing", path: normalized, documentId: existingLocal.documentId };
  }

  return { kind: "needs_read", path, switchedToNotepad: outsideRouting.switchedToNotepad };
}

export async function redirectToOwnerWindow(
  normalizedPath: string,
  ownerWindowId: string,
): Promise<void> {
  const ownerWindow = await WebviewWindow.getByLabel(ownerWindowId);
  if (ownerWindow) {
    await ownerWindow.setFocus();
  }
  await emitTo(ownerWindowId, WINDOW_EVENT_SELECT_TAB_FOR_PATH, {
    path: normalizedPath,
  });
}

export function selectTabForNormalizedPath(normalizedPath: string): boolean {
  const snapshot = appState.getSnapshot();
  const contexts = [
    { id: "notepad" as const, snapshot: snapshot.contexts.notepad },
    ...snapshot.contexts.workspaces.map((workspace) => ({
      id: workspace.id,
      snapshot: workspace.snapshot,
    })),
  ];
  for (const context of contexts) {
    for (const tab of getSessionTabs(context.snapshot.session)) {
      if (!isFileTab(tab)) {
        continue;
      }
      const documentState = context.snapshot.documents.find((doc) => doc.id === tab.documentId);
      if (
        documentState?.filePath &&
        normalizePathSync(documentState.filePath) === normalizedPath
      ) {
        appState.switchContext(context.id);
        appState.selectTab(tab.id);
        return true;
      }
    }
  }
  return false;
}

export async function refreshExistingDocumentFromDisk(
  documentId: string,
  path: string,
): Promise<OpenedFile> {
  const opened = await openPath(path);
  appState.upgradeDocumentFromOpenedFile(
    documentId,
    opened.path,
    opened.content,
    opened.contentKind,
  );
  await initializeDocumentDiskState(documentId, path);
  return opened;
}

export async function completeOpenPath(
  path: string,
  content: string,
  windowId: string,
  contentKind: FileContentKind = "text",
): Promise<string> {
  const documentId = appState.openFileInTab(path, content, contentKind);
  await claimOpenFile(path, windowId, documentId);
  await initializeDocumentDiskState(documentId, path);
  return documentId;
}

/**
 * Phase 6 — open a freshly-read file into a specific pane (file→pane DnD).
 * Sibling of {@link completeOpenPath} that routes through
 * `appState.openFileInPane` instead of `openFileInTab`; the steal/focus logic
 * lives in the reducer. Used only when a drag drops onto a pane (click-to-open
 * still uses `completeOpenPath`).
 */
export async function completeOpenPathInPane(
  path: string,
  content: string,
  windowId: string,
  paneId: string,
  contentKind: FileContentKind = "text",
): Promise<string> {
  const documentId = appState.openFileInPane(path, content, paneId, contentKind);
  await claimOpenFile(path, windowId, documentId);
  await initializeDocumentDiskState(documentId, path);
  return documentId;
}

export async function completeLargePendingOpen(
  path: string,
  fingerprint: DiskFingerprint,
  windowId: string,
): Promise<string> {
  const documentId = appState.openFileInTab(path, "", "large_pending");
  appState.setDocumentDiskState(documentId, {
    diskFingerprint: fingerprint,
    fileMissing: false,
  });
  await claimOpenFile(path, windowId, documentId);
  return documentId;
}

export async function confirmLargeFileOpen(documentId: string, path: string): Promise<void> {
  const opened = await openPath(path);
  appState.upgradeDocumentFromOpenedFile(
    documentId,
    opened.path,
    opened.content,
    opened.contentKind,
  );
  await initializeDocumentDiskState(documentId, path);
}
