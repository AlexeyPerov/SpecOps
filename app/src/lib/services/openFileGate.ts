import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { appState } from "../state/appState";
import type { ContextId, DiskFingerprint } from "../domain/contracts";
import { allTabs, isFileTab } from "../domain/contracts";
import { normalizePathSync } from "./diskFingerprint";
import { claimOpenFile, pruneOpenFileRegistryWindows } from "./openFileRegistry";
import { initializeDocumentDiskState } from "./externalFileChanges";
import type { FileContentKind } from "./fileContentKind";
import type { OpenedFile } from "./fileSystem";
import { openPath } from "./fileSystem";
import {
  WINDOW_EVENT_SELECT_TAB_FOR_PATH,
} from "./windowManager";
import { isFileContextRestricted } from "./fileContextPolicy";
import { isPathUnderRoot } from "./workspacePaths";

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
    for (const tab of allTabs(context.snapshot.session.editorLayout)) {
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
  const normalized = normalizePathSync(path);
  // Atomically reserve unowned paths before file I/O. A separate registry read
  // followed by a later claim allowed two windows to race and both open the
  // same file; claimOpenFile now returns the conflicting owner when present.
  let owner = await claimOpenFile(normalized, windowId, "");

  // A claim left behind by a window that no longer exists (crash, force quit)
  // must not silently swallow the open: verify the owner is live before
  // redirecting, and take over locally when it is not.
  if (owner && !(await WebviewWindow.getByLabel(owner.windowId))) {
    const liveWindows = await getAllWebviewWindows();
    await pruneOpenFileRegistryWindows(liveWindows.map((entry) => entry.label));
    owner = await claimOpenFile(normalized, windowId, "");
  }

  if (owner) {
    await redirectToOwnerWindow(normalized, owner.windowId);
    return { kind: "redirected", path: normalized, ownerWindowId: owner.windowId };
  }

  const restricted = isFileContextRestricted();
  const activeContextId = appState.getSnapshot().contexts.activeContextId;
  const activeWorkspaceRoot = appState.getWorkspaceRoot();
  if (
    restricted &&
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

  let switchedToNotepad = false;
  if (
    restricted &&
    activeWorkspaceRoot &&
    activeContextId !== "notepad" &&
    !isPathUnderRoot(path, activeWorkspaceRoot)
  ) {
    switchedToNotepad = appState.switchContext("notepad");
  }

  return { kind: "needs_read", path, switchedToNotepad };
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
    for (const tab of allTabs(context.snapshot.session.editorLayout)) {
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

/**
 * Line ending / BOM detected when the file was read, carried through to the document so
 * the save path can restore the file's original shape. See `textEncoding.ts`.
 */
export type OpenedFileEncoding = Pick<OpenedFile, "lineEnding" | "hasBom">;

/** Pull the encoding metadata out of an `OpenedFile` for the state-layer calls. */
export function openedFileEncoding(opened: OpenedFile): OpenedFileEncoding {
  return { lineEnding: opened.lineEnding, hasBom: opened.hasBom };
}

export async function completeOpenPath(
  path: string,
  content: string,
  windowId: string,
  contentKind: FileContentKind = "text",
  encoding?: OpenedFileEncoding,
  fingerprint?: DiskFingerprint,
): Promise<string> {
  const documentId = appState.openFileInTab(path, content, contentKind, encoding);
  await claimOpenFile(path, windowId, documentId);
  await initializeDocumentDiskState(documentId, path, fingerprint);
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
  encoding?: OpenedFileEncoding,
  fingerprint?: DiskFingerprint,
): Promise<string> {
  const documentId = appState.openFileInPane(path, content, paneId, contentKind, encoding);
  await claimOpenFile(path, windowId, documentId);
  await initializeDocumentDiskState(documentId, path, fingerprint);
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
    openedFileEncoding(opened),
  );
  await initializeDocumentDiskState(documentId, path, opened.fingerprint);
}
