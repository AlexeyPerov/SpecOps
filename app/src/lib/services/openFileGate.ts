import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appState } from "../state/appState";
import type { ContextId } from "../domain/contracts";
import { isFileTab, normalizeTabState } from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import {
  claimOpenFile,
  readOpenFileRegistry,
} from "./openFileRegistry";
import {
  initializeDocumentDiskState,
} from "./externalFileChanges";
import {
  WINDOW_EVENT_SELECT_TAB_FOR_PATH,
} from "./windowManager";
import { ensureNotepadForOutsidePath } from "./workspacePaths";

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
    for (const tab of context.snapshot.session.openTabs) {
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
    for (const tab of context.snapshot.session.openTabs) {
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

export async function completeOpenPath(
  path: string,
  content: string,
  windowId: string,
): Promise<string> {
  const documentId = appState.openFileInTab(path, content);
  await claimOpenFile(path, windowId, documentId);
  await initializeDocumentDiskState(documentId, path);
  return documentId;
}
