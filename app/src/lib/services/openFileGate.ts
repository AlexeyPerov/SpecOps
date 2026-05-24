import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appState } from "../state/appState";
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

export type RequestOpenPathResult =
  | { kind: "redirected"; path: string; ownerWindowId: string }
  | { kind: "existing"; path: string; documentId: string }
  | { kind: "needs_read"; path: string };

export async function requestOpenPath(
  path: string,
  windowId: string,
): Promise<RequestOpenPathResult> {
  const normalized = normalizePathSync(path);
  const registry = await readOpenFileRegistry();
  const owner = registry[normalized];

  if (owner && owner.windowId !== windowId) {
    await redirectToOwnerWindow(normalized, owner.windowId);
    return { kind: "redirected", path: normalized, ownerWindowId: owner.windowId };
  }

  const existingDocumentId = appState.findDocumentIdByPath(path);
  if (existingDocumentId) {
    appState.selectOrReopenTabForDocument(existingDocumentId);
    appState.touchRecentFile(path);
    await claimOpenFile(path, windowId, existingDocumentId);
    return { kind: "existing", path: normalized, documentId: existingDocumentId };
  }

  return { kind: "needs_read", path };
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
  for (const tab of snapshot.session.openTabs) {
    const documentState = snapshot.documents.find((doc) => doc.id === tab.documentId);
    if (
      documentState?.filePath &&
      normalizePathSync(documentState.filePath) === normalizedPath
    ) {
      appState.selectTab(tab.id);
      return true;
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
