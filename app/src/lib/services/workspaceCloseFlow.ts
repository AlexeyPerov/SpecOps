import type { ContextId, DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { requestConfirm } from "./confirmDialogUi";

/**
 * M3 (R4) — shared workspace-close flow.
 *
 * Replaces the previous callback-based `closeWorkspace` confirmation seam
 * with an in-app confirm. Drives the save / discard / cancel decision via
 * `requestConfirm` (async), then persists (save-all) or discards before
 * removing the workspace from the store.
 *
 * Returns `true` when the workspace was closed, `false` when the user
 * cancelled or the workspace was already gone.
 */
export async function closeWorkspaceWithConfirm(
  workspaceId: ContextId,
  notify: (message: string) => void,
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
      saveAllDirtyDocuments(dirtyDocuments);
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

function saveAllDirtyDocuments(dirtyDocuments: DocumentState[]): void {
  for (const doc of dirtyDocuments) {
    if (!doc.filePath) {
      continue;
    }
    appState.markDocumentSaved(doc.id, doc.filePath, doc.content);
  }
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
