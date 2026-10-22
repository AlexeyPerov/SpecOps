import { moveWorkspaceToWindow } from "./workspaceWindowTransfer";
import { createWorkspaceDocument, type WorkspaceDocumentKind } from "./workspaceDocuments";
import type { ContextId } from "../domain/contracts";
import { appState } from "../state/appState";
import { openVersionControlForWorkspace } from "./versionControlNavigation";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";
import { closeWorkspaceWithConfirm } from "./workspaceCloseFlow";

function isWorkspaceContextId(contextId: ContextId): boolean {
  return contextId.startsWith("ws-");
}

export interface WorkspaceContextMenuActionsDeps {
  getWorkspaceRootPath: (workspaceId: ContextId) => string | null;
  getPreviousActiveContextId: () => ContextId | null;
  setPreviousActiveContextId: (contextId: ContextId) => void;
  setConsoleOpen: (open: boolean) => void;
  setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
  loadProjectTreeRoot: () => Promise<void>;
  notify: (message: string) => void;
}

export function createWorkspaceContextMenuActions(deps: WorkspaceContextMenuActionsDeps) {
  function handleActiveContextSwitch(nextContextId: ContextId): void {
    const previousActiveContextId = deps.getPreviousActiveContextId();
    if (previousActiveContextId === null) {
      deps.setPreviousActiveContextId(nextContextId);
      return;
    }
    if (previousActiveContextId === nextContextId) {
      return;
    }
    deps.setPreviousActiveContextId(nextContextId);
    deps.setConsoleOpen(false);
    // The root-keyed project-tree effect owns loading after a context switch.
    // Calling it here as well started a second concurrent root load before the
    // controller's first result had populated its cache.
  }

  function handleSelectContext(contextId: ContextId): void {
    const switched = appState.switchContext(contextId);
    if (!switched) {
      return;
    }
    if (isWorkspaceContextId(contextId)) {
      markWorkspaceLifecycleActive();
    }
  }

  /**
   * Switches to the workspace and opens its settings view tab (kind
   * "workspace-settings"). Mirrors the
   * settings/themes view-tab pattern: the tab is a singleton within the
   * workspace's session, so re-invoking focuses the existing tab.
   */
  function openSettings(workspaceId: ContextId): void {
    const switched = appState.switchContext(workspaceId);
    if (switched && isWorkspaceContextId(workspaceId)) {
      markWorkspaceLifecycleActive();
    }
    appState.openOrFocusViewTab("workspace-settings");
  }

  /**
   * Switches to the workspace and opens its version-control view tab (kind
   * "version-control"). The tab is a singleton within
   * the workspace session, so re-invoking focuses the existing tab.
   */
  function openVersionControl(workspaceId: ContextId): void {
    openVersionControlForWorkspace(workspaceId, deps.notify);
  }

  async function openDocument(workspaceId: ContextId, kind: WorkspaceDocumentKind): Promise<void> {
    const root = deps.getWorkspaceRootPath(workspaceId);
    if (!root) return;
    try {
      await createWorkspaceDocument(root, kind);
      if (deps.getWorkspaceRootPath(workspaceId) !== root) return;
      appState.switchContext(workspaceId);
      appState.openOrFocusViewTab(kind === "tasks" ? "workspace-tasks" : "workspace-notes");
    } catch (error) { deps.notify(String(error)); }
  }

  function closeWorkspace(workspaceId: ContextId): void {
    void closeWorkspaceWithConfirm(workspaceId, deps.notify).then((closed) => {
      if (closed) {
        deps.setConsoleOpen(false);
        deps.setMarkdownViewMode("edit");
        void deps.loadProjectTreeRoot();
      }
    });
  }

  return {
    moveToWindow(workspaceId: ContextId, newWindow: boolean) { void moveWorkspaceToWindow(workspaceId, newWindow, deps.notify); },
    closeWorkspace,
    openSettings,
    openDocument,
    openVersionControl,
    handleActiveContextSwitch,
    handleSelectContext,
  };
}
