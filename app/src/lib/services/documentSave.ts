import type { DiskFingerprint, DocumentState } from "../domain/contracts";
import { allTabs } from "../domain/contracts";
import { isEditableContentKind } from "./fileContentKind";
import { appState } from "../state/appState";
import { findDocumentContext } from "../state/appState/contextHelpers";
import type { TextEncodeOptions } from "./fileSystem";
import { saveFile, saveFileAs } from "./fileSystem";
import { renameOpenFileRegistry } from "./openFileRegistry";
import { untitledSaveDefaultPath } from "./untitledSavePath";
import { isFileContextRestricted } from "./fileContextPolicy";
import { isPathUnderRoot } from "./workspacePaths";
import { handoffSavedFileToNotepad } from "./savedFileHandoff";

export type SaveDocumentDeps = {
  getWindowId: () => string;
  notify: (message: string) => void;
};

/**
 * Encoding options for writing `document` back to disk in the shape it was read in.
 *
 * Every save path must pass this. Without it the writer defaults to LF/no-BOM, which
 * silently converts CRLF files and strips BOMs on the first Cmd+S.
 */
export function documentEncodeOptions(document: DocumentState): TextEncodeOptions {
  return { lineEnding: document.lineEnding, hasBom: document.hasBom };
}

/**
 * Record a completed disk write against the document that owns it.
 *
 * Save flows read the content to write, then await the write — during which the user
 * may switch workspace. The active-context mutators would then find no matching
 * document and silently drop the patch, leaving the tab dirty with no recorded
 * fingerprint (which the next external-change check reports as a spurious "modified on
 * disk"). Resolving the owning context first keeps the write attributable to the right
 * workspace regardless of what is focused when it lands.
 */
export function applyDocumentSavedState(
  documentId: string,
  filePath: string,
  writtenContent: string,
  fingerprint: DiskFingerprint,
): void {
  const owner = findDocumentContext(appState.getSnapshot(), documentId);
  if (!owner) {
    // The tab was closed while the write was in flight. The bytes are on disk; there
    // is no buffer left to reconcile.
    return;
  }
  appState.markDocumentSavedForContext(owner.contextId, documentId, filePath, writtenContent);
  appState.setDocumentDiskStateForContext(owner.contextId, documentId, {
    diskFingerprint: fingerprint,
    fileMissing: false,
  });
}

async function persistDocument(
  document: DocumentState,
  deps: SaveDocumentDeps,
  options?: { allowWorkspaceTabMove?: boolean },
): Promise<boolean> {
  if (!isEditableContentKind(document.contentKind)) {
    deps.notify("This file is not editable in the text editor.");
    return false;
  }
  let targetPath = document.filePath;
  const previousPath = document.filePath;
  let fingerprint;

  const encodeOptions = documentEncodeOptions(document);
  if (!targetPath) {
    const saved = await saveFileAs(
      document.content,
      await untitledSaveDefaultPath(document.content, appState.getWorkspaceRoot()),
      encodeOptions,
    );
    if (!saved) {
      return false;
    }
    targetPath = saved.path;
    fingerprint = saved.fingerprint;
  } else {
    fingerprint = await saveFile({
      path: targetPath,
      content: document.content,
      ...encodeOptions,
    });
  }

  const activeWorkspaceRoot = appState.getWorkspaceRoot();
  const savedOutsideWorkspace =
    activeWorkspaceRoot !== null && !isPathUnderRoot(targetPath, activeWorkspaceRoot);
  const tabId = allTabs(appState.getActiveSession().editorLayout)
    .find((tab) => tab.kind === "file" && tab.documentId === document.id)?.id;

  if (options?.allowWorkspaceTabMove && savedOutsideWorkspace && tabId) {
    await handoffSavedFileToNotepad({
      sourceTabId: tabId,
      previousPath,
      filePath: targetPath,
      content: document.content,
      title: document.title,
      fingerprint,
      windowId: deps.getWindowId(),
    });
  } else {
    applyDocumentSavedState(document.id, targetPath, document.content, fingerprint);
    await renameOpenFileRegistry(previousPath, targetPath, deps.getWindowId(), document.id);
  }
  deps.notify(`Saved ${targetPath}`);
  return true;
}

export async function saveDocumentForClose(
  document: DocumentState,
  deps: SaveDocumentDeps,
): Promise<boolean> {
  return persistDocument(document, deps, { allowWorkspaceTabMove: isFileContextRestricted() });
}

export async function saveDocumentKeepingTab(
  document: DocumentState,
  deps: SaveDocumentDeps,
): Promise<boolean> {
  return persistDocument(document, deps);
}
