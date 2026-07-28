import type { DiskFingerprint } from "../domain/contracts";
import { appState } from "../state/appState";
import { findDocumentContext } from "../state/appState/contextHelpers";
import { claimOpenFile, renameOpenFileRegistry } from "./openFileRegistry";

/**
 * Moves a saved workspace file that is outside its workspace into Notepad.
 * The replacement Notepad document is the source of truth for disk and
 * registry state because closing the workspace tab prunes its document.
 *
 * Mid-write keystrokes (C2): the caller passes the `writtenContent` that
 * actually reached disk, captured before the await. Re-reading the document's
 * *current* content here (after the write settled) and comparing it to
 * `writtenContent` preserves any edits made during the write — the transferred
 * buffer starts dirty rather than silently reverting them and being marked clean.
 */
export async function handoffSavedFileToNotepad({
  sourceTabId,
  sourceDocumentId,
  previousPath,
  filePath,
  content,
  title,
  fingerprint,
  windowId,
}: {
  sourceTabId: string;
  /** Id of the document being moved, used to re-read its post-write content. */
  sourceDocumentId: string;
  previousPath: string | null;
  filePath: string;
  /** Content that actually reached disk (pre-await). */
  content: string;
  title: string;
  fingerprint: DiskFingerprint;
  windowId: string;
}): Promise<string | null> {
  // Re-read the document's current content *before* closing the source tab —
  // edits made while the write was in flight would otherwise be lost when the
  // tab is force-closed and the document pruned. If the document is already
  // gone (tab closed mid-save), fall back to the written content.
  const owner = findDocumentContext(appState.getSnapshot(), sourceDocumentId);
  const currentDoc = owner?.document;
  const liveContent = currentDoc?.content ?? content;

  appState.closeTabForce(sourceTabId);
  appState.switchContext("notepad");
  const documentId = appState.openTransferredTab({
    filePath,
    content: liveContent,
    title,
    lineEnding: currentDoc?.lineEnding,
    hasBom: currentDoc?.hasBom,
  });
  if (!documentId) {
    return null;
  }

  // Record the *written* content (not the live content) as the saved baseline.
  // markDocumentSaved derives isDirty by comparing the buffer to this baseline,
  // so mid-write edits (liveContent !== content) leave the transferred buffer
  // dirty with a second chance to save, rather than silently reverting them.
  appState.markDocumentSaved(documentId, filePath, content);
  appState.setDocumentDiskState(documentId, {
    diskFingerprint: fingerprint,
    fileMissing: false,
  });
  await renameOpenFileRegistry(previousPath, filePath, windowId, documentId);
  await claimOpenFile(filePath, windowId, documentId);
  return documentId;
}
