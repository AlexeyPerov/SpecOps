import type { TabState } from "./document";
import type { SessionState } from "./workspace";

/**
 * Editor split-view (layout groups). See `specs/text-editor/split-view-idea.md`
 * (§7 resolved decisions) and `split-view-execution-plan.md`.
 *
 * The editor area of each context is modeled as an `EditorLayout`: an ordered
 * list of panes, each owning its own tab strip + selected tab, plus a `slots`
 * grid descriptor (rows of pane-indices) describing the geometry. `slots` lets
 * us render presets and the close-reflow "custom" shape with a single CSS grid.
 */

export type LayoutKind =
  | "single"
  | "cols-2"
  | "rows-2"
  | "rows-3"
  | "grid-2x2"
  | "custom";

export interface EditorPane {
  id: string;
  tabs: TabState[];
  selectedTabId: string | null;
}

export interface EditorLayout {
  kind: LayoutKind;
  panes: EditorPane[];
  /**
   * Rows of pane-indices into `panes`. Describes the grid geometry.
   *   single     -> [[0]]
   *   cols-2     -> [[0, 1]]
   *   rows-2     -> [[0], [1]]
   *   rows-3     -> [[0], [1], [2]]
   *   grid-2x2   -> [[0, 1], [2, 3]]
   *   custom     -> arbitrary (2-over-1 close-reflow = [[0, 1], [2]])
   * A row narrower than the max row width renders its cell(s) spanning the full
   * grid width (this is exactly the 2-over-1 bottom-spanning cell).
   */
  slots: number[][];
  activePaneId: string;
}

const PANE_ID_PREFIX = "pane-";

let paneIdCounter = 0;

export function resetPaneIdCounter(): void {
  paneIdCounter = 0;
}

export function nextPaneId(): string {
  paneIdCounter += 1;
  return `${PANE_ID_PREFIX}${paneIdCounter}`;
}

/** Canonical slot templates per preset (pane-count is implied by the kind). */
export function presetSlots(kind: Exclude<LayoutKind, "custom">): number[][] {
  switch (kind) {
    case "single":
      return [[0]];
    case "cols-2":
      return [[0, 1]];
    case "rows-2":
      return [[0], [1]];
    case "rows-3":
      return [[0], [1], [2]];
    case "grid-2x2":
      return [
        [0, 1],
        [2, 3],
      ];
  }
}

export function expectedPaneCount(kind: LayoutKind): number {
  switch (kind) {
    case "single":
      return 1;
    case "cols-2":
    case "rows-2":
      return 2;
    case "rows-3":
      return 3;
    case "grid-2x2":
      return 4;
    case "custom":
      return 3; // close-reflow custom is always the 2-over-1 shape
  }
}

export function createEmptyPane(id: string = nextPaneId()): EditorPane {
  return { id, tabs: [], selectedTabId: null };
}

export function createSinglePaneLayout(
  tabs: TabState[],
  selectedTabId: string | null = null,
): EditorLayout {
  const pane: EditorPane = {
    id: nextPaneId(),
    tabs,
    selectedTabId: selectedTabId ?? tabs[0]?.id ?? null,
  };
  return {
    kind: "single",
    panes: [pane],
    slots: presetSlots("single"),
    activePaneId: pane.id,
  };
}

/**
 * Seed a single-pane layout from the legacy flat `openTabs`/`selectedTabId`
 * shape. Used on snapshot restore and wherever a flat list needs to become a
 * layout. (No persisted migration — AGENTS.md; the restore path re-seeds.)
 */
export function layoutFromFlatTabs(
  openTabs: TabState[],
  selectedTabId: string | null,
): EditorLayout {
  return createSinglePaneLayout(openTabs, selectedTabId);
}

/** Clamp a possibly-stale selectedTabId to one that actually exists. */
function clampSelectedTabId(pane: EditorPane): string | null {
  if (pane.selectedTabId && pane.tabs.some((tab) => tab.id === pane.selectedTabId)) {
    return pane.selectedTabId;
  }
  return pane.tabs[0]?.id ?? null;
}

/** Find a pane by id. */
export function findPane(layout: EditorLayout, paneId: string): EditorPane | undefined {
  return layout.panes.find((pane) => pane.id === paneId);
}

/**
 * Find the pane that currently holds a given tab id, and the tab itself.
 * Returns `null` when no pane has the tab. Used by the file→pane "steal" path
 * (Phase 6) and tab lookups that span the whole layout.
 */
export function findTabOwner(
  layout: EditorLayout,
  tabId: string,
): { pane: EditorPane; tab: TabState } | null {
  for (const pane of layout.panes) {
    const tab = pane.tabs.find((entry) => entry.id === tabId);
    if (tab) {
      return { pane, tab };
    }
  }
  return null;
}

export function activePane(layout: EditorLayout): EditorPane {
  const pane = layout.panes.find((entry) => entry.id === layout.activePaneId);
  return pane ?? layout.panes[0];
}

export function activePaneTabs(layout: EditorLayout): TabState[] {
  return activePane(layout).tabs;
}

export function activeSelectedTabId(layout: EditorLayout): string | null {
  return activePane(layout).selectedTabId;
}

export function activeTab(layout: EditorLayout): TabState | null {
  const tabs = activePane(layout).tabs;
  const selectedId = activePane(layout).selectedTabId;
  if (selectedId) {
    return tabs.find((tab) => tab.id === selectedId) ?? tabs[0] ?? null;
  }
  return tabs[0] ?? null;
}

/**
 * Flatten all tabs across every pane in slot reading order. Used for
 * cross-pane operations that today read the single flat strip (e.g. session
 * tab enumeration, watched-paths for external-file change watching).
 */
export function allTabs(layout: EditorLayout): TabState[] {
  const ordered: EditorPane[] = [];
  const seen = new Set<string>();
  for (const row of layout.slots) {
    for (const paneIndex of row) {
      const pane = layout.panes[paneIndex];
      if (pane && !seen.has(pane.id)) {
        seen.add(pane.id);
        ordered.push(pane);
      }
    }
  }
  for (const pane of layout.panes) {
    if (!seen.has(pane.id)) {
      ordered.push(pane);
    }
  }
  const tabs: TabState[] = [];
  for (const pane of ordered) {
    tabs.push(...pane.tabs);
  }
  return tabs;
}

/** Count of all open tabs across every pane. */
export function totalTabCount(layout: EditorLayout): number {
  return layout.panes.reduce((sum, pane) => sum + pane.tabs.length, 0);
}

/** Replace the active pane inside a layout (immutable, keeps pane id). */
function withActivePane(layout: EditorLayout, next: EditorPane): EditorLayout {
  if (next.id !== layout.activePaneId) {
    return withPane(layout, next.id, next);
  }
  return withPane(layout, layout.activePaneId, next);
}

function withPane(layout: EditorLayout, paneId: string, next: EditorPane): EditorLayout {
  if (findPane(layout, paneId) === next) {
    return layout;
  }
  return {
    ...layout,
    panes: layout.panes.map((pane) => (pane.id === paneId ? next : pane)),
  };
}

function setActivePane(layout: EditorLayout, paneId: string): EditorLayout {
  if (paneId === layout.activePaneId) {
    return layout;
  }
  if (!findPane(layout, paneId)) {
    return layout;
  }
  return { ...layout, activePaneId: paneId };
}

// ---------------------------------------------------------------------------
// Active-pane helpers (the single source of truth for "the open tabs / selected
// tab" during Phases 1–2 single-pane parity). These let the many existing
// consumers of the old flat-list model keep working through a one-line swap.
// ---------------------------------------------------------------------------

export function getSessionTabs(session: SessionState): TabState[] {
  return activePaneTabs(session.editorLayout);
}

export function getSessionSelectedTabId(session: SessionState): string | null {
  return activeSelectedTabId(session.editorLayout);
}

export function getSessionActiveTab(session: SessionState): TabState | null {
  return activeTab(session.editorLayout);
}

/** Returns the active pane of a session. */
export function getSessionActivePane(session: SessionState): EditorPane {
  return activePane(session.editorLayout);
}

// ---------------------------------------------------------------------------
// Reflow rules (close via ×). Count-based: the only "custom" shape produced is
// the 3-pane 2-over-1 ([[0,1],[2]]). See split-view-idea.md §7/§8 (F1/F2).
// ---------------------------------------------------------------------------

function templateForCount(count: number): { kind: LayoutKind; slots: number[][] } {
  switch (count) {
    case 0:
    case 1:
      return { kind: "single", slots: presetSlots("single") };
    case 2:
      return { kind: "cols-2", slots: presetSlots("cols-2") };
    case 3:
      return { kind: "custom", slots: [[0, 1], [2]] };
    default:
      return { kind: "grid-2x2", slots: presetSlots("grid-2x2") };
  }
}

/**
 * Append another pane's tabs into `intoPane` (dedupe by tab id), preserving
 * order. Returns the merged pane (a copy of `intoPane`).
 */
export function mergePaneTabs(intoPane: EditorPane, ...fromPanes: EditorPane[]): EditorPane {
  const ids = new Set(intoPane.tabs.map((tab) => tab.id));
  const appended: TabState[] = [];
  for (const from of fromPanes) {
    for (const tab of from.tabs) {
      if (!ids.has(tab.id)) {
        ids.add(tab.id);
        appended.push(tab);
      }
    }
  }
  if (appended.length === 0) {
    return intoPane;
  }
  return { ...intoPane, tabs: [...intoPane.tabs, ...appended] };
}

/**
 * Remove a pane and re-template by remaining count. Tabs from the closed pane
 * merge into the nearest surviving sibling (else pane #1). `activePaneId`
 * follows the merge target. Returns the layout unchanged if the pane does not
 * exist or would leave zero panes.
 */
export function reflowAfterClose(layout: EditorLayout, closedPaneId: string): EditorLayout {
  if (layout.panes.length <= 1) {
    return layout;
  }
  const closedIndex = layout.panes.findIndex((pane) => pane.id === closedPaneId);
  if (closedIndex < 0) {
    return layout;
  }
  const closedPane = layout.panes[closedIndex];
  const survivors = layout.panes.filter((pane) => pane.id !== closedPaneId);
  // Merge target: nearest surviving sibling by original index (left/up first),
  // falling back to the new first pane.
  const targetIndex = Math.max(0, closedIndex - 1);
  const targetPane = survivors[targetIndex] ?? survivors[0];
  const merged = mergePaneTabs(targetPane, closedPane);

  const newPanes = survivors.map((pane) => (pane.id === targetPane.id ? merged : pane));
  const { kind, slots } = templateForCount(newPanes.length);
  return {
    kind,
    panes: newPanes,
    slots,
    activePaneId: targetPane.id,
  };
}

/**
 * Re-template the current layout's tabs into a preset's slots in reading order.
 * Tabs that no longer have a slot (preset has fewer panes) merge into the
 * active pane (Q2/Q3). Presets needing more panes get fresh empty panes.
 * `activePaneId` follows the active pane when it survives; otherwise the first
 * pane becomes active.
 */
export function applyPreset(layout: EditorLayout, kind: Exclude<LayoutKind, "custom">): EditorLayout {
  const targetSlots = presetSlots(kind);
  const targetCount = targetSlots.flat().length;
  if (targetCount === 0) {
    return layout;
  }
  // Reading-order flat list of (paneId, tabs, selectedTabId) for current layout.
  const orderedCurrent: EditorPane[] = [];
  const seen = new Set<string>();
  for (const row of layout.slots) {
    for (const paneIndex of row) {
      const pane = layout.panes[paneIndex];
      if (pane && !seen.has(pane.id)) {
        seen.add(pane.id);
        orderedCurrent.push(pane);
      }
    }
  }
  for (const pane of layout.panes) {
    if (!seen.has(pane.id)) {
      orderedCurrent.push(pane);
    }
  }

  if (targetCount >= orderedCurrent.length) {
    // Same or more slots: keep tab lists in reading order, fill extras with
    // empty panes.
    const newPanes: EditorPane[] = orderedCurrent.map((pane) => ({
      id: pane.id,
      tabs: [...pane.tabs],
      selectedTabId: clampSelectedTabId(pane),
    }));
    while (newPanes.length < targetCount) {
      newPanes.push(createEmptyPane());
    }
    const activeSurvives = newPanes.some((pane) => pane.id === layout.activePaneId);
    return {
      kind,
      panes: newPanes,
      slots: targetSlots,
      activePaneId: activeSurvives ? layout.activePaneId : newPanes[0].id,
    };
  }

  // Fewer slots: merge orphaned panes' tabs into the active pane (Q3).
  const activeId = layout.activePaneId;
  const activeIndex = Math.max(
    0,
    orderedCurrent.findIndex((pane) => pane.id === activeId),
  );
  const survivors = orderedCurrent.slice(0, targetCount);
  const orphans = orderedCurrent.slice(targetCount);
  const survivorForActive = survivors[Math.min(activeIndex, survivors.length - 1)];
  const mergedIndex = survivors.findIndex((pane) => pane.id === survivorForActive.id);
  survivors[mergedIndex] = mergePaneTabs(survivorForActive, ...orphans);

  const newPanes = survivors.map((pane) => ({
    id: pane.id,
    tabs: [...pane.tabs],
    selectedTabId: clampSelectedTabId(pane),
  }));
  const activeSurvives = newPanes.some((pane) => pane.id === activeId);
  return {
    kind,
    panes: newPanes,
    slots: targetSlots,
    activePaneId: activeSurvives ? activeId : newPanes[0].id,
  };
}

// ---------------------------------------------------------------------------
// Slice-style mutators used by the reducer. Each takes a layout and returns a
// new layout (no-op returns the same reference). Phase 1 keeps these operating
// on the ACTIVE pane only; multi-pane variants are layered in Phase 3+.
// ---------------------------------------------------------------------------

export function selectTabInLayout(layout: EditorLayout, tabId: string): EditorLayout {
  const pane = activePane(layout);
  if (!pane.tabs.some((tab) => tab.id === tabId)) {
    return layout;
  }
  if (pane.selectedTabId === tabId) {
    return layout;
  }
  return withActivePane(layout, { ...pane, selectedTabId: tabId });
}

export function setActivePaneInLayout(layout: EditorLayout, paneId: string): EditorLayout {
  return setActivePane(layout, paneId);
}

/**
 * Append a tab to the active pane (or a specific pane). If a tab with the same
 * id already exists anywhere, this is a no-op (caller is expected to focus it
 * via selectTabInLayout instead).
 */
export function appendTabToPane(
  layout: EditorLayout,
  tab: TabState,
  paneId?: string,
): EditorLayout {
  const targetId = paneId ?? layout.activePaneId;
  const pane = findPane(layout, targetId) ?? activePane(layout);
  const nextPane: EditorPane = {
    ...pane,
    tabs: [...pane.tabs, tab],
    selectedTabId: tab.id,
  };
  const nextLayout = withPane(layout, pane.id, nextPane);
  return setActivePane(nextLayout, pane.id);
}

/** Replace the active pane's tabs wholesale (used by transfer/reopen helpers). */
export function setPaneTabs(
  layout: EditorLayout,
  paneId: string,
  tabs: TabState[],
  selectedTabId: string | null,
): EditorLayout {
  const pane = findPane(layout, paneId);
  if (!pane) {
    return layout;
  }
  return withPane(layout, paneId, { ...pane, tabs, selectedTabId });
}

/** Set the active pane's tabs + selection in one go. */
export function setActivePaneTabs(
  layout: EditorLayout,
  tabs: TabState[],
  selectedTabId: string | null,
): EditorLayout {
  const pane = activePane(layout);
  return withActivePane(layout, { ...pane, tabs, selectedTabId });
}

/** Reorder tabs within the active pane. */
export function reorderActivePaneTabs(
  layout: EditorLayout,
  fromIndex: number,
  toIndex: number,
): EditorLayout {
  const pane = activePane(layout);
  const next = reorderTabs(pane.tabs, fromIndex, toIndex);
  if (next === pane.tabs) {
    return layout;
  }
  return withActivePane(layout, { ...pane, tabs: next });
}

export function reorderTabs(tabs: TabState[], fromIndex: number, toIndex: number): TabState[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tabs.length ||
    toIndex >= tabs.length ||
    fromIndex === toIndex
  ) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) {
    return tabs;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Remove a single tab from a specific pane (by id), recomputing that pane's
 * `selectedTabId`. Leaves the pane empty if it was the last tab (Q6 empty-pane
 * survival). No-op (returns same ref) when the pane or tab does not exist.
 *
 * Used by the file→pane "steal" path (Phase 6): when a file is opened in a
 * target pane, any existing tab for it elsewhere is removed first (Q9 — one
 * document per context).
 */
export function removeTabFromPane(
  layout: EditorLayout,
  paneId: string,
  tabId: string,
): EditorLayout {
  const pane = findPane(layout, paneId);
  if (!pane) {
    return layout;
  }
  const idx = pane.tabs.findIndex((tab) => tab.id === tabId);
  if (idx < 0) {
    return layout;
  }
  const remaining = pane.tabs.filter((tab) => tab.id !== tabId);
  const nextSelected = recomputeSelectedTabId(pane.tabs, remaining, pane.selectedTabId);
  return withPane(layout, paneId, { ...pane, tabs: remaining, selectedTabId: nextSelected });
}

/**
 * Move a tab from one pane to another (Phase 5 tab→pane DnD). Always a move
 * (locked default). When `fromPaneId === toPaneId` this collapses to an
 * in-pane reorder (the tab is removed before `toIndex` is applied, so the index
 * matches what the user sees post-removal). The destination pane selects the
 * moved tab and becomes the active pane (focus follows the drop — P5 exit
 * criterion).
 *
 * `toIndex` is clamped to `[0, destination tab count]`; passing the length
 * appends (this is how a drop on an empty pane appends). Returns the same ref
 * when the tab or either pane is missing, or when the move would be a no-op
 * (same pane, same index).
 */
export function moveTabBetweenPanes(
  layout: EditorLayout,
  fromPaneId: string,
  tabId: string,
  toPaneId: string,
  toIndex: number,
): EditorLayout {
  const fromPane = findPane(layout, fromPaneId);
  const toPane = findPane(layout, toPaneId);
  if (!fromPane || !toPane) {
    return layout;
  }
  const fromIndex = fromPane.tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex < 0) {
    return layout;
  }
  const moved = fromPane.tabs[fromIndex];
  if (!moved) {
    return layout;
  }

  const samePane = fromPaneId === toPaneId;
  // For a same-pane move, interpret toIndex against the post-removal list so it
  // matches the visual drop position the user sees.
  const remaining = fromPane.tabs.filter((tab) => tab.id !== tabId);
  const fromSelectedNext = recomputeSelectedTabId(
    fromPane.tabs,
    remaining,
    fromPane.selectedTabId,
  );

  const baseList = samePane ? remaining : toPane.tabs;
  const clampedIndex = Math.max(0, Math.min(toIndex, baseList.length));
  if (samePane && clampedIndex === fromIndex) {
    // No-op reorder; still ensure the moved tab is selected + pane active.
    if (fromPane.selectedTabId === tabId && layout.activePaneId === toPaneId) {
      return layout;
    }
    const patched = withPane(layout, toPaneId, {
      ...toPane,
      tabs: toPane.tabs,
      selectedTabId: tabId,
    });
    return setActivePane(patched, toPaneId);
  }

  const nextToTabs = [...baseList];
  nextToTabs.splice(clampedIndex, 0, moved);

  let next: EditorLayout;
  if (samePane) {
    next = withPane(layout, toPaneId, {
      ...toPane,
      tabs: nextToTabs,
      selectedTabId: tabId,
    });
  } else {
    const fromNext = withPane(layout, fromPaneId, {
      ...fromPane,
      tabs: remaining,
      selectedTabId: fromSelectedNext,
    });
    next = withPane(fromNext, toPaneId, {
      ...toPane,
      tabs: nextToTabs,
      selectedTabId: tabId,
    });
  }
  return setActivePane(next, toPaneId);
}

/**
 * Remove tabs from the active pane (or every pane when `allPanes` is true).
 * Recomputes the pane's selectedTabId. Used by close-family operations.
 */
export function removeTabsFromActivePane(
  layout: EditorLayout,
  tabIds: ReadonlySet<string>,
): EditorLayout {
  const pane = activePane(layout);
  const remaining = pane.tabs.filter((tab) => !tabIds.has(tab.id));
  if (remaining.length === pane.tabs.length) {
    return layout;
  }
  const previousSelectedId = pane.selectedTabId;
  const nextSelected = recomputeSelectedTabId(pane.tabs, remaining, previousSelectedId);
  return withActivePane(layout, { ...pane, tabs: remaining, selectedTabId: nextSelected });
}

export function recomputeSelectedTabId(
  previousTabs: TabState[],
  remainingTabs: TabState[],
  previousSelectedId: string | null,
  preferredTabId: string | null = null,
): string | null {
  if (preferredTabId && remainingTabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }
  if (!previousSelectedId) {
    return remainingTabs[0]?.id ?? null;
  }
  if (remainingTabs.some((tab) => tab.id === previousSelectedId)) {
    return previousSelectedId;
  }
  const selectedIndex = previousTabs.findIndex((tab) => tab.id === previousSelectedId);
  if (selectedIndex >= 0) {
    for (let idx = selectedIndex - 1; idx >= 0; idx -= 1) {
      const candidateId = previousTabs[idx]?.id;
      if (candidateId && remainingTabs.some((tab) => tab.id === candidateId)) {
        return candidateId;
      }
    }
  }
  return remainingTabs[0]?.id ?? null;
}

/**
 * Set the whole layout (preset change). Re-templates current tabs into the
 * target preset's slots per Q2/Q3 (merge into active pane when shrinking).
 */
export function setLayoutKind(layout: EditorLayout, kind: LayoutKind): EditorLayout {
  if (kind === "custom") {
    return layout;
  }
  if (layout.kind === kind) {
    return layout;
  }
  return applyPreset(layout, kind);
}

/** Normalize a (possibly stale or hand-built) layout into a valid one. */
export function normalizeEditorLayout(layout: EditorLayout | undefined | null): EditorLayout {
  if (!layout || !Array.isArray(layout.panes) || layout.panes.length === 0) {
    return createSinglePaneLayout([]);
  }
  const panes = layout.panes.map((pane) => ({
    id: typeof pane.id === "string" && pane.id.length > 0 ? pane.id : nextPaneId(),
    tabs: Array.isArray(pane.tabs) ? pane.tabs : [],
    selectedTabId: typeof pane.selectedTabId === "string" ? pane.selectedTabId : null,
  }));
  const activePaneId =
    panes.some((pane) => pane.id === layout.activePaneId) ? layout.activePaneId : panes[0].id;
  const { kind, slots } = templateForCount(panes.length);
  return {
    kind,
    panes: panes.map((pane) => ({ ...pane, selectedTabId: clampSelectedTabId(pane) })),
    slots,
    activePaneId,
  };
}
