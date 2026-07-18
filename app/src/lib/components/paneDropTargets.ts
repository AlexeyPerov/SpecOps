/**
 * Cross-pane drop hit-testing for split view (layout groups). Shared by the
 * tab→pane DnD (Phase 5) and file→pane DnD (Phase 6) channels so both derive
 * "which pane is under the pointer" from one source of truth.
 *
 * The hit-test is split into a pure rect-based core (`hitTestPaneRects`) that
 * is unit-testable without a DOM, plus a DOM-collecting helper
 * (`collectPaneRects`) that walks live elements. Controllers call
 * `collectPaneRects` to gather rects on demand, then (optionally)
 * `hitTestPaneRects` for the answer.
 *
 * See `specs/text-editor/split-view-execution-plan.md` Phases 5 & 6.
 */

export interface TabRectEntry {
  tabId: string;
  /** Pre-computed client rect (left/top/right/bottom/width/height). */
  rect: PaneRect;
}

export interface PaneRectEntry {
  paneId: string;
  /** The tab-strip rect (header). Null when the pane has no strip element. */
  stripRect: PaneRect | null;
  /** The pane body rect (editor surface area). */
  bodyRect: PaneRect | null;
  /** Per-tab rects within the strip, in strip reading order. */
  tabRects: TabRectEntry[];
}

export interface PaneRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type PaneDropRegion = "strip" | "body";

export interface PaneDropTarget {
  paneId: string;
  region: PaneDropRegion;
  /**
   * Drop index within the target pane's tab strip (Phase 5 tab drops). For
   * body drops and empty-pane strips this is `null` (append). The index is
   * computed against the pane's *current* tabs (the caller removes the dragged
   * tab from its origin before applying the index when it was a cross-pane
   * move — see `moveTabBetweenPanes`).
   */
  index: number | null;
}

function rectContains(rect: PaneRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Compute the tab drop index for a strip given a pointer X. Mirrors the
 * midpoint algorithm in `tabDragController.nextDropIndex`: for each tab in
 * reading order, if the pointer is left of that tab's midpoint, return its
 * index; otherwise append (return `tabs.length`). An empty strip returns 0.
 */
export function stripDropIndex(tabRects: TabRectEntry[], x: number): number {
  if (tabRects.length === 0) {
    return 0;
  }
  for (let i = 0; i < tabRects.length; i += 1) {
    const entry = tabRects[i];
    if (!entry) {
      continue;
    }
    const midpoint = entry.rect.left + entry.rect.width / 2;
    if (x < midpoint) {
      return i;
    }
  }
  return tabRects.length;
}

/**
 * Pure hit-test against a pre-collected list of pane rects. Walks panes in the
 * given order (DOM order from the caller) and returns the first whose strip or
 * body contains `(x, y)`. The strip takes priority over the body when they
 * overlap at a boundary (a drop on the header row should land in the strip so
 * it computes a tab index). Returns `null` when no pane is hit.
 */
export function hitTestPaneRects(
  x: number,
  y: number,
  panes: PaneRectEntry[],
): PaneDropTarget | null {
  for (const pane of panes) {
    if (pane.stripRect && rectContains(pane.stripRect, x, y)) {
      return {
        paneId: pane.paneId,
        region: "strip",
        index: stripDropIndex(pane.tabRects, x),
      };
    }
  }
  for (const pane of panes) {
    if (pane.bodyRect && rectContains(pane.bodyRect, x, y)) {
      return { paneId: pane.paneId, region: "body", index: null };
    }
  }
  return null;
}

function toPaneRect(domRect: DOMRect): PaneRect {
  return {
    left: domRect.left,
    top: domRect.top,
    right: domRect.right,
    bottom: domRect.bottom,
    width: domRect.width,
    height: domRect.height,
  };
}

export interface PaneDropTargetElements {
  paneId: string;
  /** The tab-strip element (header). Null when absent. */
  stripEl: HTMLElement | null;
  /** The pane body element (drop surface for files / empty panes). */
  bodyEl: HTMLElement | null;
}

/**
 * Collect live pane rects from the DOM for hit-testing. Walks each pane's
 * strip element (gathering per-tab `[data-tab-id]` rects in DOM order) and
 * body element. Safe to call during an active drag; panes with neither a strip
 * nor a body element are skipped.
 */
export function collectPaneRects(panes: PaneDropTargetElements[]): PaneRectEntry[] {
  const out: PaneRectEntry[] = [];
  for (const pane of panes) {
    const stripRect = pane.stripEl ? toPaneRect(pane.stripEl.getBoundingClientRect()) : null;
    const bodyRect = pane.bodyEl ? toPaneRect(pane.bodyEl.getBoundingClientRect()) : null;
    const tabRects: TabRectEntry[] = [];
    if (pane.stripEl) {
      for (const node of pane.stripEl.querySelectorAll<HTMLElement>("[data-tab-id]")) {
        const tabId = node.dataset.tabId;
        if (!tabId) {
          continue;
        }
        tabRects.push({ tabId, rect: toPaneRect(node.getBoundingClientRect()) });
      }
    }
    if (!stripRect && !bodyRect) {
      continue;
    }
    out.push({ paneId: pane.paneId, stripRect, bodyRect, tabRects });
  }
  return out;
}

/**
 * Convenience: collect live rects from a list of pane elements and hit-test
 * the pointer against them. Returns `null` when no pane is hit.
 */
export function hitTestPaneElements(
  x: number,
  y: number,
  panes: PaneDropTargetElements[],
): PaneDropTarget | null {
  return hitTestPaneRects(x, y, collectPaneRects(panes));
}

/**
 * Collect pane elements from the DOM by their `data-pane-*` attributes (stamped
 * by `EditorPaneView`). Walks every `[data-pane-id]` root and pairs it with the
 * matching `[data-pane-strip]` header and `[data-pane-body]` body. Used by the
 * project-tree file drag (Phase 6), which lives outside the editor grid and so
 * can't read the grid's in-memory element registry.
 *
 * The stamped values are namespaced as `${contextId}:${paneId}` so two mounted
 * contexts with the same pane id cannot collide during a context-switch
 * transition. The context prefix is stripped here so callers continue to
 * receive bare pane ids (matching layout state and the grid's in-memory
 * registry).
 */
export function collectPaneElementsFromDom(root: ParentNode = document): PaneDropTargetElements[] {
  const out: PaneDropTargetElements[] = [];
  for (const node of root.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const namespaced = node.dataset.paneId;
    if (!namespaced) {
      continue;
    }
    const paneId = stripContextPrefix(namespaced);
    const stripEl = root.querySelector<HTMLElement>(`[data-pane-strip="${cssEscape(namespaced)}"]`);
    const bodyEl = root.querySelector<HTMLElement>(`[data-pane-body="${cssEscape(namespaced)}"]`);
    out.push({ paneId, stripEl, bodyEl });
  }
  return out;
}

/**
 * Strip the `${contextId}:` prefix from a namespaced data-pane-* value. Context
 * ids are opaque strings without a colon separator today; if that ever changes,
 * this must use the last colon (pane ids themselves never contain colons).
 */
function stripContextPrefix(namespaced: string): string {
  const index = namespaced.indexOf(":");
  return index === -1 ? namespaced : namespaced.slice(index + 1);
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
