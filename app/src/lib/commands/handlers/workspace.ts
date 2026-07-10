import { appState } from "../../state/appState";
import type { WorkspaceReorderPayload } from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
import { ensureWorkspaceReadAccess, openFolderDialog } from "../../services/fileSystem";
import { markWorkspaceLifecycleActive } from "../../services/workspaceLifecycle";
import { closeWorkspaceWithConfirm } from "../../services/workspaceCloseFlow";
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
  "workspace.close": async ({ notify }) => {
    const activeContext = appState.getActiveContext();
    if (activeContext.kind !== "workspace") {
      notify("No active workspace to close.");
      return;
    }
    await closeWorkspaceWithConfirm(activeContext.id, notify);
  },
  "workspace.reorder": (_context, payload) => {
    if (!isWorkspaceReorderPayload(payload)) {
      return;
    }
    appState.reorderWorkspaces(payload.fromIndex, payload.toIndex);
  },
};
