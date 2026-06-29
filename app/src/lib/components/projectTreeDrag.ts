import type { ProjectTreeNode } from "../services/projectTree";
import { canMoveEntry } from "../services/projectFileOps";
import { hitTestPaneElements, type PaneDropTargetElements } from "./paneDropTargets";

export const PROJECT_TREE_DRAG_THRESHOLD_PX = 5;

export interface ProjectTreeDragState {
  pointerId: number | null;
  sourcePath: string | null;
  sourceKind: ProjectTreeNode["kind"] | null;
  dropTargetPath: string | null;
  /**
   * Phase 6 — the pane id currently hovered during a file drag (for the
   * file→pane drop affordance). Null when not dragging a file, or when the
   * pointer isn't over a pane.
   */
  dropPaneId: string | null;
  didDrag: boolean;
  startX: number;
  startY: number;
}

export interface ProjectTreeDragControllerDeps {
  getWorkspaceRoot: () => string | null;
  onMove: (sourcePath: string, destDirPath: string) => Promise<void>;
  onStateChange: (state: ProjectTreeDragState) => void;
  notify: (message: string) => void;
  /**
   * Phase 6 — live pane elements for file→pane hit-testing. When omitted or
   * empty, file drags never resolve to a pane drop (they just no-op if not
   * dropped on a folder).
   */
  getPaneElements?: () => PaneDropTargetElements[];
  /**
   * Phase 6 — open a file into a specific pane. Invoked when a file-node drag
   * lands on a pane and not on a folder.
   */
  onOpenFileInPane?: (filePath: string, paneId: string) => void | Promise<void>;
}

function createInitialState(): ProjectTreeDragState {
  return {
    pointerId: null,
    sourcePath: null,
    sourceKind: null,
    dropTargetPath: null,
    dropPaneId: null,
    didDrag: false,
    startX: 0,
    startY: 0,
  };
}

export function createProjectTreeDragController(deps: ProjectTreeDragControllerDeps) {
  let state = createInitialState();

  function emit(): void {
    deps.onStateChange({ ...state });
  }

  function reset(): void {
    state = createInitialState();
    emit();
  }

  function handlePointerDown(
    event: PointerEvent,
    node: ProjectTreeNode,
  ): void {
    if (event.button !== 0) {
      return;
    }
    state = {
      pointerId: event.pointerId,
      sourcePath: node.path,
      sourceKind: node.kind,
      dropTargetPath: null,
      dropPaneId: null,
      didDrag: false,
      startX: event.clientX,
      startY: event.clientY,
    };
    emit();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (state.pointerId !== event.pointerId || !state.sourcePath) {
      return;
    }
    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (!state.didDrag && distance >= PROJECT_TREE_DRAG_THRESHOLD_PX) {
      state = { ...state, didDrag: true };
      emit();
      return;
    }
    if (!state.didDrag) {
      return;
    }
    // Phase 6 — track the hovered pane for the file-drop affordance. Only file
    // nodes can drop into panes (folders move between directories). The actual
    // drop is resolved in `finishDrop`.
    if (state.sourceKind === "file") {
      const panes = deps.getPaneElements?.() ?? [];
      const nextDropPaneId =
        panes.length > 0
          ? (hitTestPaneElements(event.clientX, event.clientY, panes)?.paneId ?? null)
          : null;
      if (nextDropPaneId !== state.dropPaneId) {
        state = { ...state, dropPaneId: nextDropPaneId };
        emit();
      }
    }
  }

  function setDropTarget(path: string | null): void {
    if (state.dropTargetPath === path) {
      return;
    }
    state = { ...state, dropTargetPath: path };
    emit();
  }

  async function finishDrop(): Promise<boolean> {
    const workspaceRoot = deps.getWorkspaceRoot();
    const sourcePath = state.sourcePath;
    const sourceKind = state.sourceKind;
    const destDir = state.dropTargetPath;
    const dropPaneId = state.dropPaneId;
    const didDrag = state.didDrag;
    reset();
    if (!didDrag || !workspaceRoot || !sourcePath) {
      return false;
    }
    // Folder drop takes priority (the existing move-to-folder behavior).
    if (destDir) {
      const error = canMoveEntry(workspaceRoot, sourcePath, destDir);
      if (error) {
        deps.notify(error);
        return true;
      }
      await deps.onMove(sourcePath, destDir);
      return true;
    }
    // Phase 6 — file→pane drop. Only file nodes, and only when the controller
    // has pane wiring. A directory drag that escapes the tree is a no-op
    // (folders can't open in a pane).
    if (sourceKind === "file" && dropPaneId && deps.onOpenFileInPane) {
      await deps.onOpenFileInPane(sourcePath, dropPaneId);
      return true;
    }
    return false;
  }

  function cancel(): void {
    reset();
  }

  return {
    getState: () => state,
    handlePointerDown,
    handlePointerMove,
    setDropTarget,
    finishDrop,
    cancel,
    reset,
  };
}
