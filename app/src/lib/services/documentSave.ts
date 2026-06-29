import type { DocumentState } from "../domain/contracts";
import { getSessionTabs } from "../domain/contracts";
import { isEditableContentKind } from "./fileContentKind";
import { appState } from "../state/appState";
import { saveFile, saveFileAs } from "./fileSystem";
import { renameOpenFileRegistry } from "./openFileRegistry";
import { untitledSaveDefaultPath } from "./untitledSavePath";
import { isPathUnderRoot } from "./workspacePaths";

export type SaveDocumentDeps = {
  getWindowId: () => string;
  notify: (message: string) => void;
};

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

  if (!targetPath) {
    const saved = await saveFileAs(
      document.content,
      await untitledSaveDefaultPath(document.content, appState.getWorkspaceRoot()),
    );
    if (!saved) {
      return false;
    }
    targetPath = saved.path;
    fingerprint = saved.fingerprint;
  } else {
    fingerprint = await saveFile({ path: targetPath, content: document.content });
  }

  appState.markDocumentSaved(document.id, targetPath, document.content);
  const activeWorkspaceRoot = appState.getWorkspaceRoot();
  const savedOutsideWorkspace =
    activeWorkspaceRoot !== null && !isPathUnderRoot(targetPath, activeWorkspaceRoot);
  const tabId = getSessionTabs(appState.getActiveSession())
    .find((tab) => tab.kind === "file" && tab.documentId === document.id)?.id;

  if (options?.allowWorkspaceTabMove && savedOutsideWorkspace && tabId) {
    appState.closeTabForce(tabId);
    appState.switchContext("notepad");
    appState.openTransferredTab({
      filePath: targetPath,
      content: document.content,
      title: document.title,
    });
  }

  appState.setDocumentDiskState(document.id, {
    diskFingerprint: fingerprint,
    fileMissing: false,
  });
  await renameOpenFileRegistry(previousPath, targetPath, deps.getWindowId(), document.id);
  deps.notify(`Saved ${targetPath}`);
  return true;
}

export async function saveDocumentForClose(
  document: DocumentState,
  deps: SaveDocumentDeps,
): Promise<boolean> {
  return persistDocument(document, deps, { allowWorkspaceTabMove: true });
}

export async function saveDocumentKeepingTab(
  document: DocumentState,
  deps: SaveDocumentDeps,
): Promise<boolean> {
  return persistDocument(document, deps);
}
