import type { DiskFingerprint } from "../domain/contracts";
import { appState } from "../state/appState";
import { claimOpenFile, renameOpenFileRegistry } from "./openFileRegistry";

/**
 * Moves a saved workspace file that is outside its workspace into Notepad.
 * The replacement Notepad document is the source of truth for disk and
 * registry state because closing the workspace tab prunes its document.
 */
export async function handoffSavedFileToNotepad({
  sourceTabId,
  previousPath,
  filePath,
  content,
  title,
  fingerprint,
  windowId,
}: {
  sourceTabId: string;
  previousPath: string | null;
  filePath: string;
  content: string;
  title: string;
  fingerprint: DiskFingerprint;
  windowId: string;
}): Promise<string | null> {
  appState.closeTabForce(sourceTabId);
  appState.switchContext("notepad");
  const documentId = appState.openTransferredTab({ filePath, content, title });
  if (!documentId) {
    return null;
  }

  appState.markDocumentSaved(documentId, filePath, content);
  appState.setDocumentDiskState(documentId, {
    diskFingerprint: fingerprint,
    fileMissing: false,
  });
  await renameOpenFileRegistry(previousPath, filePath, windowId, documentId);
  await claimOpenFile(filePath, windowId, documentId);
  return documentId;
}
