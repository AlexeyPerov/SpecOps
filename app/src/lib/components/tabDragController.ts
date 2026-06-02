import type { TabState } from "../domain/contracts";
import { isAgentTab } from "../domain/contracts";
import { moveTabToNewWindow } from "../services/tabWindowTransfer";

export const DRAG_THRESHOLD_PX = 4;

export interface TabDragState {
  pointerId: number | null;
  pressedTabId: string | null;
  dragTabId: string | null;
  dragFromIndex: number;
  dropIndex: number;
  dragOffsetX: number;
  dragOffsetY: number;
  dragPointerX: number;
  dragPointerY: number;
  dragPointerStartX: number;
  dragTabRect: DOMRect | null;
  tabRects: Map<string, DOMRect>;
  didDrag: boolean;
  isFinishingDrag: boolean;
}

export interface TabDragControllerDeps {
  getOpenTabs: () => TabState[];
  getTabStripEl: () => HTMLDivElement | null;
  onSelect: (tabId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  getWindowId: () => string;
  notify: (message: string) => void;
  onStateChange: (state: TabDragState) => void;
}

function createInitialState(): TabDragState {
  return {
    pointerId: null,
    pressedTabId: null,
    dragTabId: null,
    dragFromIndex: -1,
    dropIndex: -1,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragTabRect: null,
    tabRects: new Map(),
    didDrag: false,
    isFinishingDrag: false,
  };
}

function cloneState(state: TabDragState): TabDragState {
  return {
    ...state,
    tabRects: new Map(state.tabRects),
  };
}

export function previewTabs(
  sourceTabs: TabState[],
  isDragging: boolean,
  sourceIndex: number,
  targetIndex: number,
): TabState[] {
  if (!isDragging || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return sourceTabs;
  }
  const next = [...sourceTabs];
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) {
    return sourceTabs;
  }
  next.splice(targetIndex, 0, moved);
  return next;
}

export function createTabDragController(deps: TabDragControllerDeps) {
  let state = createInitialState();

  function emitState(): void {
    deps.onStateChange(cloneState(state));
  }

  function collectTabRects(): void {
    const next = new Map<string, DOMRect>();
    const tabStripEl = deps.getTabStripEl();
    if (!tabStripEl) {
      state.tabRects = next;
      return;
    }
    for (const node of tabStripEl.querySelectorAll<HTMLElement>("[data-tab-id]")) {
      const tabId = node.dataset.tabId;
      if (!tabId) {
        continue;
      }
      next.set(tabId, node.getBoundingClientRect());
    }
    state.tabRects = next;
  }

  function nextDropIndex(pointerX: number): number {
    const openTabs = deps.getOpenTabs();
    const tabsWithoutDragged = openTabs.filter((tab) => tab.id !== state.dragTabId);
    if (tabsWithoutDragged.length === 0) {
      return state.dragFromIndex;
    }

    for (let i = 0; i < tabsWithoutDragged.length; i += 1) {
      const tab = tabsWithoutDragged[i];
      const rect = state.tabRects.get(tab.id);
      if (!rect) {
        continue;
      }
      const midpoint = rect.left + rect.width / 2;
      if (pointerX < midpoint) {
        return i;
      }
    }
    return tabsWithoutDragged.length;
  }

  function isPointerOutsideTabStrip(pointerX: number, pointerY: number): boolean {
    const tabStripEl = deps.getTabStripEl();
    if (!tabStripEl) {
      return false;
    }
    const stripRect = tabStripEl.getBoundingClientRect();
    const outsideStrip =
      pointerX < stripRect.left ||
      pointerX > stripRect.right ||
      pointerY < stripRect.top ||
      pointerY > stripRect.bottom;
    if (outsideStrip) {
      return true;
    }
    return (
      pointerX < 0 ||
      pointerY < 0 ||
      pointerX > document.documentElement.clientWidth ||
      pointerY > document.documentElement.clientHeight
    );
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
    state.isFinishingDrag = true;
    const activePointerId = state.pointerId;
    const fromIndex = state.dragFromIndex;
    const toIndex = state.dropIndex;
    const activeTabId = state.dragTabId;
    const pointerX = state.dragPointerX;
    const pointerY = state.dragPointerY;
    const wasDrag = state.didDrag;

    state = {
      ...createInitialState(),
      isFinishingDrag: true,
    };

    removePointerListeners();
    const tabStripEl = deps.getTabStripEl();
    if (activePointerId !== null) {
      for (const node of tabStripEl?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []) {
        if (node.hasPointerCapture(activePointerId)) {
          node.releasePointerCapture(activePointerId);
        }
      }
    }

    if (commitReorder && wasDrag && activeTabId) {
      if (isPointerOutsideTabStrip(pointerX, pointerY)) {
        void moveTabToNewWindow({
          tabId: activeTabId,
          sourceWindowId: deps.getWindowId(),
          notify: deps.notify,
        }).then((transferred) => {
          if (transferred) {
            deps.notify("Transferred tab to new window.");
          }
        });
      } else if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
        deps.onReorder(fromIndex, toIndex);
        deps.onSelect(activeTabId);
      }
    } else if (!wasDrag && activeTabId) {
      deps.onSelect(activeTabId);
    }

    state.isFinishingDrag = false;
    emitState();
  }

  function onPointerMove(event: PointerEvent): void {
    if (state.pointerId === null || event.pointerId !== state.pointerId || !state.dragTabRect || !state.dragTabId) {
      return;
    }

    state.dragPointerX = event.clientX;
    state.dragPointerY = event.clientY;

    const distance = Math.abs(event.clientX - state.dragPointerStartX);
    if (!state.didDrag && distance < DRAG_THRESHOLD_PX) {
      emitState();
      return;
    }

    state.didDrag = true;
    collectTabRects();
    state.dropIndex = nextDropIndex(event.clientX);
    emitState();
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

  function pointerDown(event: PointerEvent, tab: TabState, index: number): void {
    if (event.button !== 0 || state.isFinishingDrag) {
      return;
    }
    if (isAgentTab(tab)) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const dragTabRect = target.getBoundingClientRect();
    state = {
      ...createInitialState(),
      pointerId: event.pointerId,
      pressedTabId: tab.id,
      dragTabId: tab.id,
      dragFromIndex: index,
      dropIndex: index,
      dragPointerStartX: event.clientX,
      dragPointerX: event.clientX,
      dragPointerY: event.clientY,
      dragTabRect,
      dragOffsetX: event.clientX - dragTabRect.left,
      dragOffsetY: event.clientY - dragTabRect.top,
    };

    collectTabRects();
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
    getState: (): TabDragState => cloneState(state),
    pointerDown,
    destroy,
  };
}
