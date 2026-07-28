import type { ContextId, WorkspaceEntry } from "../domain/contracts";
import { DRAG_THRESHOLD_PX, pointerDragDistance } from "./tabDragController";

export const WORKSPACE_SCROLL_EDGE_PX = 24;
export const WORKSPACE_SCROLL_SPEED_PX = 8;

export interface WorkspaceDragState {
  pointerId: number | null;
  pressedWorkspaceId: ContextId | null;
  dragWorkspaceId: ContextId | null;
  dragFromIndex: number;
  dropIndex: number;
  dragOffsetX: number;
  dragOffsetY: number;
  dragPointerX: number;
  dragPointerY: number;
  dragPointerStartX: number;
  dragPointerStartY: number;
  dragWorkspaceRect: DOMRect | null;
  activityRailRect: DOMRect | null;
  workspaceRects: Map<ContextId, DOMRect>;
  didDrag: boolean;
  isFinishingDrag: boolean;
}

export interface WorkspaceRailDragControllerDeps {
  getWorkspaces: () => WorkspaceEntry[];
  getRailWorkspacesEl: () => HTMLDivElement | null;
  getActivityRailEl: () => HTMLElement | null;
  onSelect: (workspaceId: ContextId) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onStateChange: (state: WorkspaceDragState) => void;
}

function createInitialState(): WorkspaceDragState {
  return {
    pointerId: null,
    pressedWorkspaceId: null,
    dragWorkspaceId: null,
    dragFromIndex: -1,
    dropIndex: -1,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragPointerStartY: 0,
    dragWorkspaceRect: null,
    activityRailRect: null,
    workspaceRects: new Map(),
    didDrag: false,
    isFinishingDrag: false,
  };
}

function cloneState(state: WorkspaceDragState): WorkspaceDragState {
  return {
    ...state,
    workspaceRects: new Map(state.workspaceRects),
  };
}

export function previewWorkspaces(
  sourceWorkspaces: WorkspaceEntry[],
  isDragging: boolean,
  sourceIndex: number,
  targetIndex: number,
): WorkspaceEntry[] {
  if (!isDragging || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return sourceWorkspaces;
  }
  const next = [...sourceWorkspaces];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) {
    return sourceWorkspaces;
  }
  next.splice(targetIndex, 0, moved);
  return next;
}

export function nextWorkspaceDropIndex(
  workspaces: WorkspaceEntry[],
  workspaceRects: Map<ContextId, DOMRect>,
  dragWorkspaceId: ContextId | null,
  pointerY: number,
  fallbackIndex: number,
): number {
  const workspacesWithoutDragged = workspaces.filter((workspace) => workspace.id !== dragWorkspaceId);
  if (workspacesWithoutDragged.length === 0 || workspaceRects.size === 0) {
    return fallbackIndex;
  }

  for (let i = 0; i < workspacesWithoutDragged.length; i += 1) {
    const workspace = workspacesWithoutDragged[i];
    const rect = workspaceRects.get(workspace.id);
    if (!rect) {
      continue;
    }
    const midpoint = rect.top + rect.height / 2;
    if (pointerY < midpoint) {
      return i;
    }
  }
  return workspacesWithoutDragged.length;
}

export function isPointerInsideRect(pointerX: number, pointerY: number, rect: DOMRect): boolean {
  return (
    pointerX >= rect.left &&
    pointerX <= rect.right &&
    pointerY >= rect.top &&
    pointerY <= rect.bottom
  );
}

function scrollEdgeForPointer(
  railWorkspacesEl: HTMLElement,
  pointerY: number,
): "up" | "down" | null {
  const rect = railWorkspacesEl.getBoundingClientRect();
  if (pointerY < rect.top + WORKSPACE_SCROLL_EDGE_PX) {
    return "up";
  }
  if (pointerY > rect.bottom - WORKSPACE_SCROLL_EDGE_PX) {
    return "down";
  }
  return null;
}

export function createWorkspaceRailDragController(deps: WorkspaceRailDragControllerDeps) {
  let state = createInitialState();
  let scrollRafId: number | null = null;
  /** Coalesces workspace-rect collection + drop-index updates to one per frame (M64). */
  let moveRafId: number | null = null;

  function emitState(): void {
    deps.onStateChange(cloneState(state));
  }

  function stopAutoScrollLoop(): void {
    if (scrollRafId !== null) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
  }

  function applyDragLayout(): void {
    if (!state.didDrag || !state.dragWorkspaceId) {
      return;
    }
    collectWorkspaceRects();
    state.dropIndex = nextWorkspaceDropIndex(
      deps.getWorkspaces(),
      state.workspaceRects,
      state.dragWorkspaceId,
      state.dragPointerY,
      state.dragFromIndex,
    );
    emitState();
  }

  function scheduleDragLayout(): void {
    if (moveRafId !== null) {
      return;
    }
    moveRafId = requestAnimationFrame(() => {
      moveRafId = null;
      applyDragLayout();
    });
  }

  function flushDragLayout(): void {
    if (moveRafId === null) {
      return;
    }
    cancelAnimationFrame(moveRafId);
    moveRafId = null;
    applyDragLayout();
  }

  function startAutoScrollLoop(): void {
    if (scrollRafId !== null) {
      return;
    }

    const tick = (): void => {
      scrollRafId = null;
      const railWorkspacesEl = deps.getRailWorkspacesEl();
      if (!state.didDrag || !railWorkspacesEl) {
        return;
      }

      const edge = scrollEdgeForPointer(railWorkspacesEl, state.dragPointerY);
      if (!edge) {
        // Pointer left the scroll edge — stop ticking until a later move
        // restarts the loop. Avoids a perpetual rAF while dragging mid-list (M64).
        return;
      }
      if (edge === "up") {
        railWorkspacesEl.scrollTop -= WORKSPACE_SCROLL_SPEED_PX;
      } else {
        railWorkspacesEl.scrollTop += WORKSPACE_SCROLL_SPEED_PX;
      }
      // Defer rect collection to the next frame so we don't read layout in the
      // same turn as the scrollTop write (forced sync layout — M64).
      scheduleDragLayout();
      scrollRafId = requestAnimationFrame(tick);
    };

    scrollRafId = requestAnimationFrame(tick);
  }

  function collectWorkspaceRects(): void {
    const next = new Map<ContextId, DOMRect>();
    const railWorkspacesEl = deps.getRailWorkspacesEl();
    if (!railWorkspacesEl) {
      state.workspaceRects = next;
      return;
    }
    for (const node of railWorkspacesEl.querySelectorAll<HTMLElement>("[data-workspace-id]")) {
      const workspaceId = node.dataset.workspaceId as ContextId | undefined;
      if (!workspaceId) {
        continue;
      }
      next.set(workspaceId, node.getBoundingClientRect());
    }
    state.workspaceRects = next;
    const activityRailEl = deps.getActivityRailEl();
    state.activityRailRect = activityRailEl?.getBoundingClientRect() ?? null;
  }

  function isPointerOverRailWorkspaces(pointerX: number, pointerY: number): boolean {
    const railWorkspacesEl = deps.getRailWorkspacesEl();
    if (!railWorkspacesEl) {
      return false;
    }
    return isPointerInsideRect(pointerX, pointerY, railWorkspacesEl.getBoundingClientRect());
  }

  function removePointerListeners(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
  }

  function finishDrag(commitReorder: boolean): void {
    if (state.isFinishingDrag) {
      return;
    }
    flushDragLayout();
    state.isFinishingDrag = true;
    stopAutoScrollLoop();

    const activePointerId = state.pointerId;
    const fromIndex = state.dragFromIndex;
    const toIndex = state.dropIndex;
    const activeWorkspaceId = state.dragWorkspaceId;
    const pointerX = state.dragPointerX;
    const pointerY = state.dragPointerY;
    const wasDrag = state.didDrag;
    const pointerOverRail = isPointerOverRailWorkspaces(pointerX, pointerY);

    state = {
      ...createInitialState(),
      isFinishingDrag: true,
    };

    removePointerListeners();
    const railWorkspacesEl = deps.getRailWorkspacesEl();
    if (activePointerId !== null) {
      for (const node of railWorkspacesEl?.querySelectorAll<HTMLElement>("[data-workspace-id]") ?? []) {
        if (node.hasPointerCapture(activePointerId)) {
          node.releasePointerCapture(activePointerId);
        }
      }
    }

    if (
      commitReorder &&
      wasDrag &&
      activeWorkspaceId &&
      pointerOverRail &&
      fromIndex >= 0 &&
      toIndex >= 0 &&
      fromIndex !== toIndex
    ) {
      deps.onReorder(fromIndex, toIndex);
    } else if (!wasDrag && activeWorkspaceId) {
      deps.onSelect(activeWorkspaceId);
    }

    state.isFinishingDrag = false;
    emitState();
  }

  function onPointerMove(event: PointerEvent): void {
    if (
      state.pointerId === null ||
      event.pointerId !== state.pointerId ||
      !state.dragWorkspaceRect ||
      !state.dragWorkspaceId
    ) {
      return;
    }

    state.dragPointerX = event.clientX;
    state.dragPointerY = event.clientY;

    const distance = pointerDragDistance(
      event.clientX,
      event.clientY,
      state.dragPointerStartX,
      state.dragPointerStartY,
    );
    if (!state.didDrag && distance < DRAG_THRESHOLD_PX) {
      emitState();
      return;
    }

    state.didDrag = true;
    // Coalesce workspace getBoundingClientRect walks to one rAF per frame (M64).
    scheduleDragLayout();
    const railWorkspacesEl = deps.getRailWorkspacesEl();
    if (railWorkspacesEl && scrollEdgeForPointer(railWorkspacesEl, event.clientY)) {
      startAutoScrollLoop();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (state.pointerId === null || event.pointerId !== state.pointerId) {
      return;
    }
    finishDrag(true);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (state.pointerId === null || event.pointerId !== state.pointerId) {
      return;
    }
    finishDrag(false);
  }

  function pointerDown(event: PointerEvent, workspace: WorkspaceEntry, index: number): void {
    if (event.button !== 0 || state.isFinishingDrag) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const dragWorkspaceRect = target.getBoundingClientRect();
    state = {
      ...createInitialState(),
      pointerId: event.pointerId,
      pressedWorkspaceId: workspace.id,
      dragWorkspaceId: workspace.id,
      dragFromIndex: index,
      dropIndex: index,
      dragPointerStartX: event.clientX,
      dragPointerStartY: event.clientY,
      dragPointerX: event.clientX,
      dragPointerY: event.clientY,
      dragWorkspaceRect,
      dragOffsetX: event.clientX - dragWorkspaceRect.left,
      dragOffsetY: event.clientY - dragWorkspaceRect.top,
    };

    collectWorkspaceRects();
    target.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    emitState();
  }

  function destroy(): void {
    finishDrag(false);
  }

  return {
    getState: (): WorkspaceDragState => cloneState(state),
    pointerDown,
    destroy,
  };
}
