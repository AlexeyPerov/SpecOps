import type { TabState } from "../domain/contracts";
import { isSessionTab } from "../domain/contracts";
import { moveTabFromDrag } from "../services/tabWindowTransfer";
import {
  hitTestPaneElements,
  type PaneDropTargetElements,
} from "./paneDropTargets";

export const DRAG_THRESHOLD_PX = 4;

export interface TabDragState {
  pointerId: number | null;
  pressedTabId: string | null;
  dragTabId: string | null;
  dragFromIndex: number;
  dropIndex: number;
  /**
   * Phase 5 — the pane id the dragged tab would land in if dropped now. Null
   * means "no cross-pane target" (drop resolves to the source strip's
   * `dropIndex`, or a tear-off when outside every pane). Equal to the source
   * `paneId` means an in-strip reorder.
   */
  dropPaneId: string | null;
  dragOffsetX: number;
  dragOffsetY: number;
  dragPointerX: number;
  dragPointerY: number;
  dragPointerStartX: number;
  dragPointerStartY: number;
  dragPointerScreenX: number;
  dragPointerScreenY: number;
  dragTabRect: DOMRect | null;
  tabRects: Map<string, DOMRect>;
  didDrag: boolean;
  isFinishingDrag: boolean;
}

export interface TabDragControllerDeps {
  /** The source pane's tab list (the strip this controller is bound to). */
  getOpenTabs: () => TabState[];
  /** The source pane's strip element. */
  getTabStripEl: () => HTMLDivElement | null;
  /**
   * The source pane's id (Phase 5). Defaults to the empty string; when empty,
   * cross-pane moves are disabled (the controller behaves as before — in-strip
   * reorder + tear-off only).
   */
  getPaneId?: () => string;
  /**
   * Phase 5 — all panes' DOM elements for cross-pane hit-testing. When omitted
   * or returning an empty list, the controller falls back to in-strip-only
   * behavior (single-pane / legacy call sites).
   */
  getPaneElements?: () => PaneDropTargetElements[];
  /** Returns the current tab count for any pane, used to append on body drops. */
  getPaneTabCount?: (paneId: string) => number;
  onSelect: (tabId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  /**
   * Phase 5 — move a tab between panes. Receives the source pane id, the moved
   * tab id, the destination pane id, and the drop index within the destination
   * (post-removal when same-pane). Only invoked for a cross-pane drop.
   */
  onMoveBetweenPanes?: (
    fromPaneId: string,
    tabId: string,
    toPaneId: string,
    toIndex: number,
  ) => void;
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
    dropPaneId: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragPointerX: 0,
    dragPointerY: 0,
    dragPointerStartX: 0,
    dragPointerStartY: 0,
    dragPointerScreenX: 0,
    dragPointerScreenY: 0,
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

export function pointerDragDistance(
  pointerX: number,
  pointerY: number,
  startX: number,
  startY: number,
): number {
  return Math.hypot(pointerX - startX, pointerY - startY);
}

export function shouldTearOffTab(
  pointerX: number,
  pointerY: number,
  startX: number,
  startY: number,
  didDrag: boolean,
  thresholdPx = DRAG_THRESHOLD_PX,
): boolean {
  return didDrag || pointerDragDistance(pointerX, pointerY, startX, startY) >= thresholdPx;
}

export function crossPaneDropIndex(
  targetIndex: number | null,
  destinationTabCount: number,
): number {
  return targetIndex ?? destinationTabCount;
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
    const sourcePaneId = deps.getPaneId?.() ?? null;
    const dropPaneId = state.dropPaneId;
    const pointerX = state.dragPointerX;
    const pointerY = state.dragPointerY;
    const pointerStartX = state.dragPointerStartX;
    const pointerStartY = state.dragPointerStartY;
    const pointerScreenX = state.dragPointerScreenX;
    const pointerScreenY = state.dragPointerScreenY;
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

    // Phase 5 — cross-pane move takes priority over reorder/tear-off. Only
    // fires when the drop resolved to a *different* pane than the source (a
    // same-pane hit falls through to the in-strip reorder path below).
    if (
      commitReorder &&
      wasDrag &&
      activeTabId &&
      sourcePaneId &&
      dropPaneId &&
      dropPaneId !== sourcePaneId &&
      toIndex >= 0
    ) {
      deps.onMoveBetweenPanes?.(sourcePaneId, activeTabId, dropPaneId, toIndex);
      state.isFinishingDrag = false;
      emitState();
      return;
    }

    const tearOff =
      commitReorder &&
      activeTabId &&
      isPointerOutsideTabStrip(pointerX, pointerY) &&
      shouldTearOffTab(pointerX, pointerY, pointerStartX, pointerStartY, wasDrag);

    if (tearOff) {
      void moveTabFromDrag({
        tabId: activeTabId,
        sourceWindowId: deps.getWindowId(),
        screenX: pointerScreenX,
        screenY: pointerScreenY,
        notify: deps.notify,
      });
    } else if (commitReorder && wasDrag && activeTabId) {
      if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
        deps.onReorder(fromIndex, toIndex);
        deps.onSelect(activeTabId);
      } else if (fromIndex >= 0 && toIndex >= 0 && fromIndex === toIndex) {
        // Slight pointer movement still counts as a tab click.
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
    state.dragPointerScreenX = event.screenX;
    state.dragPointerScreenY = event.screenY;

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
    collectTabRects();
    // Phase 5 — hit-test every pane; if a *different* pane is under the
    // pointer, record it as the drop target (and its strip's drop index). A
    // same-pane hit (or no pane-elements wired) keeps the in-strip `dropIndex`.
    const sourcePaneId = deps.getPaneId?.() ?? null;
    const paneElements = deps.getPaneElements?.() ?? [];
    const crossPaneTarget =
      sourcePaneId && paneElements.length > 0
        ? hitTestPaneElements(event.clientX, event.clientY, paneElements)
        : null;
    if (crossPaneTarget && crossPaneTarget.paneId !== sourcePaneId) {
      state.dropPaneId = crossPaneTarget.paneId;
      // For a strip hit on the other pane, use its computed index; for a body
      // hit (or empty strip), append.
      state.dropIndex = crossPaneDropIndex(
        crossPaneTarget.index,
        deps.getPaneTabCount?.(crossPaneTarget.paneId) ?? deps.getOpenTabs().length,
      );
    } else {
      state.dropPaneId = crossPaneTarget ? crossPaneTarget.paneId : null;
      state.dropIndex = nextDropIndex(event.clientX);
    }
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
    if (isSessionTab(tab)) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    // Tab activation must not depend on the later window-level pointerup used
    // to finish a drag. A layout remount or interrupted pointer sequence should
    // still make an ordinary click select its tab.
    deps.onSelect(tab.id);

    const dragTabRect = target.getBoundingClientRect();
    state = {
      ...createInitialState(),
      pointerId: event.pointerId,
      pressedTabId: tab.id,
      dragTabId: tab.id,
      dragFromIndex: index,
      dropIndex: index,
      dragPointerStartX: event.clientX,
      dragPointerStartY: event.clientY,
      dragPointerScreenX: event.screenX,
      dragPointerScreenY: event.screenY,
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
