import { getProjectCatalog, projectIdentity, updateProjectCatalog } from './workspaceCatalog';
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

export interface WorkspaceContextMenuState {
  workspaceId: ContextId;
  x: number;
  y: number;
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
  getWorkspaceRootPath: (workspaceId: ContextId) => string | null;
  getPreviousActiveContextId: () => ContextId | null;
  setPreviousActiveContextId: (contextId: ContextId) => void;
  setConsoleOpen: (open: boolean) => void;
  setMarkdownViewMode: (mode: "edit" | "split" | "preview") => void;
  loadProjectTreeRoot: () => Promise<void>;
  notify: (message: string) => void;
  writeClipboardText?: (text: string) => Promise<void>;
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

  /**
   * Detach the capture-phase window listeners unconditionally. Called from the
   * host's unmount lifecycle so a menu left open when the host is destroyed does
   * not leak `pointerdown`/`keydown` handlers for the page lifetime.
   */
  function detach(): void {
    window.removeEventListener("pointerdown", onWindowPointerDown);
    window.removeEventListener("keydown", onWindowKeydown);
  }

  function open(workspaceId: ContextId, x: number, y: number): void {
    deps.setMenu({ workspaceId, x, y });
    window.addEventListener("pointerdown", onWindowPointerDown);
    window.addEventListener("keydown", onWindowKeydown);
  }

  function menuProjects() {
    const menu = deps.getMenu();
    const root = menu && deps.getWorkspaceRootPath(menu.workspaceId);
    const project = root ? getProjectCatalog().projects[projectIdentity(root)] : undefined;
    if (!project) return [];
    return Object.values(getProjectCatalog().projects).filter(entry => !entry.hiddenFromRail &&
      (project.pinned ? entry.pinned : !entry.pinned && entry.folderId === project.folderId))
      .sort((a, b) => (project.pinned ? a.pinnedOrder - b.pinnedOrder : a.order - b.order) || a.id.localeCompare(b.id));
  }
  function menuIndex(): number {
    const menu = deps.getMenu();
    const root = menu && deps.getWorkspaceRootPath(menu.workspaceId);
    return root ? menuProjects().findIndex(project => project.id === projectIdentity(root)) : -1;
  }
  function menuCount(): number { return menuProjects().length; }
  function move(direction: "up" | "down"): void {
    const projects = menuProjects();
    const index = menuIndex();
    if (computeWorkspaceReorderTarget(index, direction, projects.length) === null) return;
    const project = projects[index];
    const beforeId = direction === 'up' ? projects[index - 1].id : projects[index + 2]?.id ?? null;
    void updateProjectCatalog([{ type: 'moveProject', id: project.id, beforeId,
      ...(project.pinned ? { pinned: true } : { folderId: project.folderId, pinned: false }) }]).catch(error => deps.notify(String(error)));
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
    openVersionControlForWorkspace(workspaceId, deps.notify);
    close();
  }

  async function openDocument(workspaceId: ContextId, kind: WorkspaceDocumentKind): Promise<void> {
    const root = deps.getWorkspaceRootPath(workspaceId);
    close();
    if (!root) return;
    try {
      await createWorkspaceDocument(root, kind);
      if (deps.getWorkspaceRootPath(workspaceId) !== root) return;
      appState.switchContext(workspaceId);
      appState.openOrFocusViewTab(kind === "tasks" ? "workspace-tasks" : "workspace-notes");
    } catch (error) { deps.notify(String(error)); }
  }

  async function copyPath(workspaceId: ContextId): Promise<void> {
    const rootPath = deps.getWorkspaceRootPath(workspaceId);
    if (!rootPath) {
      close();
      return;
    }
    try {
      await (deps.writeClipboardText ?? navigator.clipboard.writeText.bind(navigator.clipboard))(
        rootPath,
      );
    } catch {
      // clipboard is best-effort from the workspace menu
    }
    close();
  }

  function closeWorkspace(workspaceId: ContextId): void {
    void closeWorkspaceWithConfirm(workspaceId, deps.notify).then((closed) => {
      if (closed) {
        deps.setConsoleOpen(false);
        deps.setMarkdownViewMode("edit");
        void deps.loadProjectTreeRoot();
      }
      close();
    });
  }

  return {
    moveToWindow(workspaceId: ContextId, newWindow: boolean) { close(); void moveWorkspaceToWindow(workspaceId, newWindow, deps.notify); },
    open,
    close,
    detach,
    menuIndex,
    menuCount,
    move,
    closeWorkspace,
    copyPath,
    openSettings,
    openDocument,
    openVersionControl,
    handleActiveContextSwitch,
    handleSelectContext,
  };
}
