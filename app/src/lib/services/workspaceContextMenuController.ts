import { CHAT_HTTP_CONTEXT_ID, type ContextId, type DocumentState } from "../domain/contracts";
import { appState } from "../state/appState";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";

function isWorkspaceContextId(contextId: ContextId): boolean {
  return contextId.startsWith("ws-");
}

export type CloseWorkspaceAction = "save-all" | "discard-all" | "cancel";

export interface WorkspaceContextMenuState {
  workspaceId: ContextId;
  x: number;
  y: number;
}

export interface CloseWorkspacePrompts {
  confirmSaveAll: (dirtyCount: number) => boolean;
  confirmDiscardAll: () => boolean;
}

export function resolveCloseWorkspaceAction(
  dirtyDocumentCount: number,
  prompts: CloseWorkspacePrompts,
): CloseWorkspaceAction {
  if (dirtyDocumentCount === 0) {
    return "discard-all";
  }
  if (prompts.confirmSaveAll(dirtyDocumentCount)) {
    return "save-all";
  }
  return prompts.confirmDiscardAll() ? "discard-all" : "cancel";
}

export function findWorkspaceIndex(
  workspaceIds: readonly string[],
  workspaceId: string,
): number {
  return workspaceIds.findIndex((id) => id === workspaceId);
}

export function computeWorkspaceReorderTarget(
  currentIndex: number,
  direction: "up" | "down",
  workspaceCount: number,
): number | null {
  if (currentIndex < 0) {
    return null;
  }
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= workspaceCount) {
    return null;
  }
  return targetIndex;
}

export interface WorkspaceContextMenuActionsDeps {
  getMenu: () => WorkspaceContextMenuState | null;
  setMenu: (menu: WorkspaceContextMenuState | null) => void;
  getMenuEl: () => HTMLDivElement | null;
  getWorkspaceIds: () => readonly ContextId[];
  getPreviousActiveContextId: () => ContextId | null;
  setPreviousActiveContextId: (contextId: ContextId) => void;
  setConsoleOpen: (open: boolean) => void;
  setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
  loadProjectTreeRoot: () => Promise<void>;
  notify: (message: string) => void;
  confirmSaveAll: (count: number) => boolean;
  confirmDiscardAll: () => boolean;
}

export function createWorkspaceContextMenuActions(deps: WorkspaceContextMenuActionsDeps) {
  function onWindowPointerDown(event: PointerEvent): void {
    if (!deps.getMenu()) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && deps.getMenuEl()?.contains(target)) {
      return;
    }
    close();
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (deps.getMenu() && event.key === "Escape") {
      close();
    }
  }

  function close(): void {
    if (!deps.getMenu()) {
      return;
    }
    deps.setMenu(null);
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("keydown", onWindowKeydown);
  }

  function open(workspaceId: ContextId, x: number, y: number): void {
    deps.setMenu({ workspaceId, x, y });
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeydown);
  }

  function resolveCloseAction(dirtyDocuments: DocumentState[]): CloseWorkspaceAction {
    return resolveCloseWorkspaceAction(dirtyDocuments.length, {
      confirmSaveAll: deps.confirmSaveAll,
      confirmDiscardAll: deps.confirmDiscardAll,
    });
  }

  function menuIndex(): number {
    const menu = deps.getMenu();
    if (!menu) {
      return -1;
    }
    return findWorkspaceIndex(deps.getWorkspaceIds(), menu.workspaceId);
  }

  function move(direction: "up" | "down"): void {
    if (!deps.getMenu()) {
      return;
    }
    const index = menuIndex();
    const targetIndex = computeWorkspaceReorderTarget(
      index,
      direction,
      deps.getWorkspaceIds().length,
    );
    if (targetIndex === null) {
      return;
    }
    appState.reorderWorkspaces(index, targetIndex);
    close();
  }

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
    close();
    if (nextContextId !== CHAT_HTTP_CONTEXT_ID) {
      void deps.loadProjectTreeRoot();
    }
  }

  function handleSelectContext(contextId: ContextId): void {
    const switched = appState.switchContext(contextId);
    if (!switched) {
      return;
    }
    if (isWorkspaceContextId(contextId)) {
      markWorkspaceLifecycleActive();
    }
    close();
  }

  /**
   * Switches to the workspace and opens its settings view tab (kind
   * "workspace-settings"), then closes the menu. Mirrors the
   * settings/themes view-tab pattern: the tab is a singleton within the
   * workspace's session, so re-invoking focuses the existing tab.
   */
  function openSettings(workspaceId: ContextId): void {
    const switched = appState.switchContext(workspaceId);
    if (switched && isWorkspaceContextId(workspaceId)) {
      markWorkspaceLifecycleActive();
    }
    appState.openOrFocusViewTab("workspace-settings");
    close();
  }

  /**
   * Switches to the workspace and opens its version-control view tab (kind
   * "version-control"), then closes the menu. The tab is a singleton within
   * the workspace session, so re-invoking focuses the existing tab.
   */
  function openVersionControl(workspaceId: ContextId): void {
    const switched = appState.switchContext(workspaceId);
    if (switched && isWorkspaceContextId(workspaceId)) {
      markWorkspaceLifecycleActive();
    }
    appState.openOrFocusViewTab("version-control");
    close();
  }

  function closeWorkspace(workspaceId: ContextId): void {
    const closed = appState.closeWorkspace(workspaceId, {
      resolveAction: resolveCloseAction,
      saveAllDirtyDocuments: (dirtyDocuments) => {
        for (const doc of dirtyDocuments) {
          if (!doc.filePath) {
            continue;
          }
          appState.markDocumentSaved(doc.id, doc.filePath, doc.content);
        }
      },
    });
    if (closed) {
      deps.notify("Workspace closed.");
      deps.setConsoleOpen(false);
      deps.setMarkdownViewMode("edit");
      void deps.loadProjectTreeRoot();
    }
    close();
  }

  return {
    open,
    close,
    menuIndex,
    move,
    closeWorkspace,
    openSettings,
    openVersionControl,
    handleActiveContextSwitch,
    handleSelectContext,
  };
}
