import { appState } from "../../state/appState";
import type { WorkspaceReorderPayload } from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
import { ensureWorkspaceReadAccess, openFolderDialog } from "../../services/fileSystem";
import { markWorkspaceLifecycleActive } from "../../services/workspaceLifecycle";
import type { CommandHandlerMap } from "./types";

function isWorkspaceReorderPayload(payload: unknown): payload is WorkspaceReorderPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const candidate = payload as WorkspaceReorderPayload;
  return (
    typeof candidate.fromIndex === "number" &&
    typeof candidate.toIndex === "number" &&
    Number.isInteger(candidate.fromIndex) &&
    Number.isInteger(candidate.toIndex)
  );
}

export const workspaceHandlers: CommandHandlerMap = {
  "workspace.add": async ({ notify }) => {
    const selected = await openFolderDialog();
    if (!selected) {
      return;
    }
    const normalizedRoot = normalizePathSync(selected);
    const accessStatus = await ensureWorkspaceReadAccess(normalizedRoot);
    if (accessStatus === "blocked") {
      notify("Workspace path is inaccessible. Check permissions and try again.");
      return;
    }

    const workspaceId = appState.addWorkspace(normalizedRoot);
    if (!workspaceId) {
      notify("Workspace is already open.");
      return;
    }
    markWorkspaceLifecycleActive();
    notify("Workspace added.");
  },
  "workspace.close": ({ notify }) => {
    const activeContext = appState.getActiveContext();
    if (activeContext.kind !== "workspace") {
      notify("No active workspace to close.");
      return;
    }
    const closed = appState.closeWorkspace(activeContext.id, {
      resolveAction: (dirtyDocuments) => {
        const fileCount = dirtyDocuments.length;
        const shouldSave = window.confirm(
          `Workspace has ${fileCount} unsaved file(s). Press OK to Save All, or Cancel for more options.`,
        );
        if (shouldSave) {
          return "save-all";
        }
        const shouldDiscard = window.confirm("Discard all unsaved changes and close workspace?");
        return shouldDiscard ? "discard-all" : "cancel";
      },
      saveAllDirtyDocuments: (dirtyDocuments) => {
        for (const documentState of dirtyDocuments) {
          if (!documentState.filePath) {
            continue;
          }
          appState.markDocumentSaved(documentState.id, documentState.filePath, documentState.content);
        }
      },
    });
    if (closed) {
      notify("Workspace closed.");
    }
  },
  "workspace.reorder": (_context, payload) => {
    if (!isWorkspaceReorderPayload(payload)) {
      return;
    }
    appState.reorderWorkspaces(payload.fromIndex, payload.toIndex);
  },
};
