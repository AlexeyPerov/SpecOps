import type { ProjectTreeNode } from "../services/projectTree";
import { canMoveEntry } from "../services/projectFileOps";

export const PROJECT_TREE_DRAG_THRESHOLD_PX = 5;

export interface ProjectTreeDragState {
  pointerId: number | null;
  sourcePath: string | null;
  sourceKind: ProjectTreeNode["kind"] | null;
  dropTargetPath: string | null;
  didDrag: boolean;
  startX: number;
  startY: number;
}

export interface ProjectTreeDragControllerDeps {
  getWorkspaceRoot: () => string | null;
  onMove: (sourcePath: string, destDirPath: string) => Promise<void>;
  onStateChange: (state: ProjectTreeDragState) => void;
  notify: (message: string) => void;
}

function createInitialState(): ProjectTreeDragState {
  return {
    pointerId: null,
    sourcePath: null,
    sourceKind: null,
    dropTargetPath: null,
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
    const destDir = state.dropTargetPath;
    const didDrag = state.didDrag;
    reset();
    if (!didDrag || !workspaceRoot || !sourcePath || !destDir) {
      return false;
    }
    const error = canMoveEntry(workspaceRoot, sourcePath, destDir);
    if (error) {
      deps.notify(error);
      return true;
    }
    await deps.onMove(sourcePath, destDir);
    return true;
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
