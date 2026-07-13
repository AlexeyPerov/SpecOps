import type { ContextId, DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { requestConfirm } from "./confirmDialogUi";
import { saveFile, saveFileAs } from "./fileSystem";
import { untitledSaveDefaultPath } from "./untitledSavePath";
import { renameOpenFileRegistry } from "./openFileRegistry";

/**
 * Shared workspace-close flow.
 *
 * Drives the save / discard / cancel decision via `requestConfirm` (async),
 * then persists (save-all) or discards before removing the workspace from the
 * store. Returns `true` when the workspace was closed, `false` when the user
 * cancelled (or when a write failed / a save-as was dismissed) or the workspace
 * was already gone.
 *
 * Persistence stays in this flow layer — `closeWorkspace` itself remains a pure
 * state transition. The dirty documents are written to disk via the same path
 * as the Save / Save All commands, and in-memory state is synced with the
 * context-aware disk-state API because the closing workspace may not be the
 * active context.
 */
export async function closeWorkspaceWithConfirm(
  workspaceId: ContextId,
  notify: (message: string) => void,
  deps: { getWindowId: () => string } = { getWindowId: () => "main" },
): Promise<boolean> {
  const dirtyDocuments = appState.getWorkspaceDirtyDocuments(workspaceId);

  if (dirtyDocuments.length > 0) {
    const shouldSave = await requestConfirm({
      title: "Unsaved changes",
      message:
        `This workspace has ${dirtyDocuments.length} unsaved file(s). ` +
        "Save changes before closing?",
      confirmLabel: "Save all",
      cancelLabel: "More options",
    });
    if (shouldSave) {
      const saved = await saveAllDirtyDocumentsToDisk(workspaceId, dirtyDocuments, notify, deps);
      if (!saved) {
        return false;
      }
      return finishClose(workspaceId, notify);
    }
    const shouldDiscard = await requestConfirm({
      title: "Discard changes",
      message: "Discard all unsaved changes and close this workspace?",
      confirmLabel: "Discard & close",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!shouldDiscard) {
      return false;
    }
  }

  return finishClose(workspaceId, notify);
}

/**
 * Persist every dirty workspace document to disk, mirroring the Save All
 * command's write path. Untitled documents (`filePath === null`) go through
 * save-as; if the user dismisses any save-as dialog the whole close is
 * aborted (returns `false`) so no buffer is silently lost. Each successful
 * write also records the post-write disk fingerprint so a subsequent watcher
 * self-echo is suppressed.
 */
async function saveAllDirtyDocumentsToDisk(
  workspaceId: ContextId,
  dirtyDocuments: DocumentState[],
  notify: (message: string) => void,
  deps: { getWindowId: () => string },
): Promise<boolean> {
  let saved = 0;
  for (const doc of dirtyDocuments) {
    let targetPath = doc.filePath;
    const previousPath = doc.filePath;
    let fingerprint;
    if (!targetPath) {
      const savedAs = await saveFileAs(
        doc.content,
        await untitledSaveDefaultPath(doc.content, appState.getWorkspaceRoot(workspaceId)),
      );
      if (!savedAs) {
        // Cancelled save-as: abort the whole close so the user can decide what
        // to do instead of dropping the unsaved buffer on workspace removal.
        notify("Close cancelled: save was dismissed.");
        return false;
      }
      targetPath = savedAs.path;
      fingerprint = savedAs.fingerprint;
    } else {
      fingerprint = await saveFile({ path: targetPath, content: doc.content });
    }
    appState.markDocumentSavedForContext(workspaceId, doc.id, targetPath, doc.content);
    appState.setDocumentDiskStateForContext(workspaceId, doc.id, {
      diskFingerprint: fingerprint,
      fileMissing: false,
    });
    await renameOpenFileRegistry(previousPath, targetPath, deps.getWindowId(), doc.id);
    saved += 1;
  }
  if (saved > 0) {
    notify(`Saved ${saved} document(s).`);
  }
  return true;
}

function finishClose(
  workspaceId: ContextId,
  notify: (message: string) => void,
): boolean {
  const closed = appState.closeWorkspace(workspaceId);
  if (closed) {
    notify("Workspace closed.");
  }
  return closed;
}
