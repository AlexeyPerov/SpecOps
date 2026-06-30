import { describe, expect, it } from "vitest";
import type { TabState } from "./contracts";
import {
  activePane,
  activeSelectedTabId,
  activeTab,
  activePaneTabs,
  allTabs,
  applyPreset,
  createEmptyPane,
  createSinglePaneLayout,
  expectedPaneCount,
  findPane,
  findTabOwner,
  getSessionSelectedTabId,
  getSessionTabs,
  layoutFromFlatTabs,
  mergePaneTabs,
  moveTabBetweenPanes,
  nextPaneId,
  normalizeEditorLayout,
  presetSlots,
  reflowAfterClose,
  removeMatchingTabsFromAllPanes,
  removeTabFromPane,
  restructureEditorLayout,
  selectTabInLayout,
  setActivePaneInLayout,
  setLayoutKind,
  totalTabCount,
  type EditorLayout,
  type EditorPane,
  type LayoutKind,
} from "./editorLayout";

function fileTab(id: string): TabState {
  return { id, kind: "file", documentId: `doc-${id}`, pinned: false };
}

function sessionTab(id: string, sessionId = id): TabState {
  return { id, kind: "session", sessionId, pinned: false };
}

function viewTab(id: string): TabState {
  return { id, kind: "view", view: "settings", pinned: false };
}

function pane(id: string, tabs: TabState[], selectedTabId: string | null = null): EditorPane {
  return { id, tabs, selectedTabId: selectedTabId ?? tabs[0]?.id ?? null };
}

function buildLayout(
  kind: LayoutKind,
  panes: EditorPane[],
  slots: number[][],
  activePaneId?: string,
): EditorLayout {
  return { kind, panes, slots, activePaneId: activePaneId ?? panes[0].id };
}

describe("presetSlots", () => {
  it("returns canonical slot templates for every preset", () => {
    expect(presetSlots("single")).toEqual([[0]]);
    expect(presetSlots("cols-2")).toEqual([[0, 1]]);
    expect(presetSlots("rows-2")).toEqual([[0], [1]]);
    expect(presetSlots("rows-3")).toEqual([[0], [1], [2]]);
    expect(presetSlots("grid-2x2")).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("expectedPaneCount matches presetSlots span", () => {
    for (const kind of ["single", "cols-2", "rows-2", "rows-3", "grid-2x2"] as const) {
      expect(expectedPaneCount(kind)).toBe(presetSlots(kind).flat().length);
    }
  });
});

describe("createSinglePaneLayout", () => {
  it("seeds a one-pane single layout from a flat tab list", () => {
    const tabs = [fileTab("t1"), fileTab("t2")];
    const layout = createSinglePaneLayout(tabs, "t2");
    expect(layout.kind).toBe("single");
    expect(layout.panes).toHaveLength(1);
    expect(layout.slots).toEqual([[0]]);
    expect(layout.activePaneId).toBe(layout.panes[0].id);
    expect(activeSelectedTabId(layout)).toBe("t2");
  });

  it("defaults the selected tab to the first tab when omitted", () => {
    const layout = createSinglePaneLayout([fileTab("t1"), fileTab("t2")]);
    expect(activeSelectedTabId(layout)).toBe("t1");
  });

  it("allows an empty single pane with null selection", () => {
    const layout = createSinglePaneLayout([]);
    expect(activePaneTabs(layout)).toEqual([]);
    expect(activeSelectedTabId(layout)).toBeNull();
  });
});

describe("layoutFromFlatTabs (legacy re-seed)", () => {
  it("wraps a flat list + selected id into a single-pane layout", () => {
    const layout = layoutFromFlatTabs([fileTab("t1")], "t1");
    expect(layout.kind).toBe("single");
    expect(activePaneTabs(layout)).toHaveLength(1);
  });
});

describe("active-pane derivation", () => {
  it("activePane falls back to the first pane when activePaneId is stale", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("t1")]), pane("p2", [fileTab("t2")])],
      [[0, 1]],
      "missing",
    );
    expect(activePane(layout).id).toBe("p1");
  });

  it("activeTab resolves the selected tab, falling back to the first", () => {
    const layout = createSinglePaneLayout([fileTab("t1"), fileTab("t2")], "t2");
    expect(activeTab(layout)?.id).toBe("t2");
    const layout2 = createSinglePaneLayout([fileTab("t1"), fileTab("t2")], "gone");
    expect(activeTab(layout2)?.id).toBe("t1");
  });
});

describe("selectTabInLayout", () => {
  it("sets the active pane's selected tab", () => {
    const layout = createSinglePaneLayout([fileTab("t1"), fileTab("t2")], "t1");
    const next = selectTabInLayout(layout, "t2");
    expect(activeSelectedTabId(next)).toBe("t2");
  });

  it("is a no-op for unknown tab ids", () => {
    const layout = createSinglePaneLayout([fileTab("t1")], "t1");
    expect(selectTabInLayout(layout, "missing")).toBe(layout);
  });

  it("is a no-op when the tab is already selected", () => {
    const layout = createSinglePaneLayout([fileTab("t1"), fileTab("t2")], "t1");
    expect(selectTabInLayout(layout, "t1")).toBe(layout);
  });
});

describe("setActivePaneInLayout", () => {
  it("moves focus to the named pane", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("t1")]), pane("p2", [fileTab("t2")])],
      [[0, 1]],
    );
    const next = setActivePaneInLayout(layout, "p2");
    expect(next.activePaneId).toBe("p2");
    expect(activePane(next).id).toBe("p2");
  });

  it("is a no-op for unknown pane ids", () => {
    const layout = createSinglePaneLayout([fileTab("t1")]);
    expect(setActivePaneInLayout(layout, "nope")).toBe(layout);
  });
});

describe("totalTabCount / allTabs", () => {
  it("counts and flattens tabs across panes in slot reading order", () => {
    const layout = buildLayout(
      "grid-2x2",
      [
        pane("p1", [fileTab("a")]),
        pane("p2", [fileTab("b"), fileTab("c")]),
        pane("p3", [sessionTab("s1")]),
        pane("p4", [fileTab("d")]),
      ],
      [
        [0, 1],
        [2, 3],
      ],
    );
    expect(totalTabCount(layout)).toBe(5);
    expect(allTabs(layout).map((t) => t.id)).toEqual(["a", "b", "c", "s1", "d"]);
  });

  it("does not duplicate a pane that appears in two slot cells", () => {
    const layout = buildLayout("custom", [pane("p1", [fileTab("a")]), pane("p2", [fileTab("b")])], [
      [0],
      [0, 1],
    ]);
    expect(allTabs(layout).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("mergePaneTabs", () => {
  it("appends non-duplicate tabs in order", () => {
    const into = pane("p1", [fileTab("t1"), fileTab("t2")]);
    const merged = mergePaneTabs(into, pane("p2", [fileTab("t2"), fileTab("t3")]));
    expect(merged.tabs.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("is a no-op (same reference) when nothing new is appended", () => {
    const into = pane("p1", [fileTab("t1")]);
    expect(mergePaneTabs(into, pane("p2", [fileTab("t1")]))).toBe(into);
  });
});

describe("reflowAfterClose (count-based close → shape)", () => {
  it("4 → 3 produces the 2-over-1 custom shape and merges into the sibling", () => {
    const layout = buildLayout(
      "grid-2x2",
      [
        pane("p1", [fileTab("a")]),
        pane("p2", [fileTab("b")]),
        pane("p3", [fileTab("c")]),
        pane("p4", [fileTab("d")], "d"),
      ],
      [
        [0, 1],
        [2, 3],
      ],
      "p4",
    );
    const next = reflowAfterClose(layout, "p3");
    expect(next.kind).toBe("custom");
    expect(next.slots).toEqual([[0, 1], [2]]);
    expect(next.panes).toHaveLength(3);
    // Closing p3 (index 2) merges its tabs into the nearest surviving sibling (p2, index 1).
    expect(activePane(next).id).toBe("p2");
  });

  it("3 → 2 snaps to cols-2", () => {
    const layout = buildLayout(
      "custom",
      [pane("p1", [fileTab("a")]), pane("p2", [fileTab("b")]), pane("p3", [fileTab("c")])],
      [[0, 1], [2]],
    );
    const next = reflowAfterClose(layout, "p1");
    expect(next.kind).toBe("cols-2");
    expect(next.slots).toEqual([[0, 1]]);
    expect(next.panes).toHaveLength(2);
  });

  it("2 → 1 snaps to single", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("a")]), pane("p2", [fileTab("b")])],
      [[0, 1]],
    );
    const next = reflowAfterClose(layout, "p2");
    expect(next.kind).toBe("single");
    expect(next.slots).toEqual([[0]]);
    expect(totalTabCount(next)).toBe(2);
  });

  it("refuses to drop below a single pane", () => {
    const layout = createSinglePaneLayout([fileTab("a")]);
    expect(reflowAfterClose(layout, layout.panes[0].id)).toBe(layout);
  });

  it("is a no-op for an unknown pane id", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("a")]), pane("p2", [fileTab("b")])],
      [[0, 1]],
    );
    expect(reflowAfterClose(layout, "missing")).toBe(layout);
  });
});

describe("applyPreset", () => {
  it("grows: single → grid-2x2 keeps existing tabs and adds empty panes", () => {
    const layout = createSinglePaneLayout([fileTab("a"), fileTab("b")], "b");
    const next = applyPreset(layout, "grid-2x2");
    expect(next.kind).toBe("grid-2x2");
    expect(next.panes).toHaveLength(4);
    expect(next.panes[0].tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.panes[1].tabs).toEqual([]);
    // Active pane survives.
    expect(next.activePaneId).toBe(layout.panes[0].id);
  });

  it("shrinks: grid → cols-2 merges orphaned tabs into the active pane", () => {
    const activePaneId = "p2";
    const layout = buildLayout(
      "grid-2x2",
      [
        pane("p1", [fileTab("a")]),
        pane("p2", [fileTab("b")]),
        pane("p3", [fileTab("c")]),
        pane("p4", [fileTab("d")]),
      ],
      [
        [0, 1],
        [2, 3],
      ],
      activePaneId,
    );
    const next = applyPreset(layout, "cols-2");
    expect(next.kind).toBe("cols-2");
    expect(next.panes).toHaveLength(2);
    // p1, p2 survive; p3 + p4 tabs merge into p2 (the active pane's survivor).
    expect(activePane(next).tabs.map((t) => t.id)).toEqual(["b", "c", "d"]);
  });
});

describe("setLayoutKind", () => {
  it("is a no-op when the kind already matches", () => {
    const layout = createSinglePaneLayout([fileTab("a")]);
    expect(setLayoutKind(layout, "single")).toBe(layout);
  });

  it("is a no-op for custom (never settable from the menu)", () => {
    const layout = createSinglePaneLayout([fileTab("a")]);
    expect(setLayoutKind(layout, "custom")).toBe(layout);
  });
});

describe("normalizeEditorLayout", () => {
  it("falls back to an empty single-pane layout for bad input", () => {
    const fallback = normalizeEditorLayout(undefined);
    expect(fallback.kind).toBe("single");
    expect(fallback.panes).toHaveLength(1);
    expect(activePaneTabs(fallback)).toEqual([]);
  });

  it("clamps a stale selectedTabId to a valid one", () => {
    const layout = normalizeEditorLayout({
      kind: "single",
      panes: [{ id: "p1", tabs: [fileTab("t1"), fileTab("t2")], selectedTabId: "gone" }],
      slots: [[0]],
      activePaneId: "p1",
    });
    expect(activeSelectedTabId(layout)).toBe("t1");
  });

  it("reassigns a stale activePaneId to the first pane", () => {
    const layout = normalizeEditorLayout({
      kind: "single",
      panes: [{ id: "p1", tabs: [fileTab("t1")], selectedTabId: "t1" }],
      slots: [[0]],
      activePaneId: "missing",
    });
    expect(layout.activePaneId).toBe("p1");
  });

  it("preserves a multi-pane layout and recomputes slots from pane count", () => {
    const layout = normalizeEditorLayout({
      kind: "grid-2x2",
      panes: [
        pane("p1", [fileTab("t1")], "t1"),
        pane("p2", [fileTab("t2")], "t2"),
        pane("p3", [fileTab("t3")], "t3"),
        pane("p4", [fileTab("t4")], "t4"),
      ],
      // Deliberately stale slots/kind; both get recomputed.
      slots: [[0]],
      activePaneId: "p3",
    });
    expect(layout.panes.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(layout.activePaneId).toBe("p3");
    expect(layout.slots).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(layout.kind).toBe("grid-2x2");
  });
});

describe("restructureEditorLayout (Phase 7 restore)", () => {
  it("preserves the multi-pane structure, keeping surviving tabs in their panes", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("t1"), fileTab("t2")], "t2"), pane("p2", [fileTab("t3")], "t3")],
      [[0, 1]],
      "p2",
    );
    const next = restructureEditorLayout(layout, () => true);
    expect(next.panes.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(next.panes[0].tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(next.panes[0].selectedTabId).toBe("t2");
    expect(next.panes[1].tabs.map((t) => t.id)).toEqual(["t3"]);
    expect(next.activePaneId).toBe("p2");
    expect(next.slots).toEqual([[0, 1]]);
  });

  it("drops tabs that fail the predicate per-pane and clamps each pane's selection", () => {
    const layout = buildLayout(
      "cols-2",
      [
        pane("p1", [fileTab("t1"), fileTab("t2")], "t2"),
        pane("p2", [fileTab("t3")], "t3"),
      ],
      [[0, 1]],
      "p1",
    );
    // Drop t2 (active in p1) and t3 (only tab in p2).
    const next = restructureEditorLayout(layout, (tab) => tab.id !== "t2" && tab.id !== "t3");
    expect(next.panes[0].tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(next.panes[0].selectedTabId).toBe("t1");
    // Empty pane survives (Q6).
    expect(next.panes[1].tabs).toEqual([]);
    expect(next.panes[1].selectedTabId).toBeNull();
  });

  it("keeps an emptied pane in place (Q6 empty-pane survival)", () => {
    const layout = buildLayout(
      "rows-2",
      [pane("p1", [fileTab("t1")], "t1"), pane("p2", [fileTab("t2")], "t2")],
      [[0], [1]],
      "p1",
    );
    const next = restructureEditorLayout(layout, (tab) => tab.id === "t1");
    expect(next.panes).toHaveLength(2);
    expect(next.panes[1].tabs).toEqual([]);
    expect(next.panes[1].selectedTabId).toBeNull();
  });

  it("reassigns activePaneId to the first pane when the active pane id is stale", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("t1")], "t1"), pane("p2", [fileTab("t2")], "t2")],
      [[0, 1]],
      "gone",
    );
    const next = restructureEditorLayout(layout, () => true);
    expect(next.activePaneId).toBe("p1");
  });

  it("falls back to a single empty pane for missing/malformed input", () => {
    expect(restructureEditorLayout(undefined, () => true).panes).toHaveLength(1);
    expect(
      restructureEditorLayout({ kind: "single", panes: [], slots: [], activePaneId: "x" }, () => true)
        .panes,
    ).toHaveLength(1);
    expect(restructureEditorLayout(null, () => true).panes).toHaveLength(1);
  });
});

describe("removeMatchingTabsFromAllPanes (Phase 7 persist strip)", () => {
  it("is a no-op (same ref) when no pane has a matching tab", () => {
    const layout = buildLayout(
      "cols-2",
      [pane("p1", [fileTab("t1")], "t1"), pane("p2", [fileTab("t2")], "t2")],
      [[0, 1]],
      "p1",
    );
    expect(removeMatchingTabsFromAllPanes(layout, () => false)).toBe(layout);
  });

  it("strips matching tabs from every pane, preserving pane structure", () => {
    const layout = buildLayout(
      "grid-2x2",
      [
        pane("p1", [viewTab("v1"), fileTab("t1")], "v1"),
        pane("p2", [fileTab("t2"), viewTab("v2")], "t2"),
        pane("p3", [fileTab("t3")], "t3"),
        pane("p4", [viewTab("v3")], "v3"),
      ],
      [
        [0, 1],
        [2, 3],
      ],
      "p2",
    );
    const next = removeMatchingTabsFromAllPanes(layout, (tab) => tab.kind === "view");
    expect(next.panes[0].tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(next.panes[0].selectedTabId).toBe("t1");
    expect(next.panes[1].tabs.map((t) => t.id)).toEqual(["t2"]);
    expect(next.panes[3].tabs).toEqual([]);
    expect(next.panes[3].selectedTabId).toBeNull();
    // Structure unchanged.
    expect(next.panes.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(next.slots).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("does not mutate the input layout", () => {
    const layout = buildLayout(
      "single",
      [pane("p1", [viewTab("v1"), fileTab("t1")], "t1")],
      [[0]],
      "p1",
    );
    const before = layout.panes[0].tabs.length;
    removeMatchingTabsFromAllPanes(layout, (tab) => tab.kind === "view");
    expect(layout.panes[0].tabs).toHaveLength(before);
  });
});

describe("session-level accessors", () => {
  it("getSessionTabs / getSessionSelectedTabId read the active pane", () => {
    const session = {
      editorLayout: createSinglePaneLayout([fileTab("t1"), fileTab("t2")], "t2"),
      lastActiveWindowId: "main",
      windowBounds: null,
    };
    expect(getSessionTabs(session).map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(getSessionSelectedTabId(session)).toBe("t2");
  });
});

describe("nextPaneId", () => {
  it("produces stable-ish sequential ids", () => {
    const a = nextPaneId();
    const b = nextPaneId();
    expect(a).toMatch(/^pane-\d+$/);
    expect(b).toMatch(/^pane-\d+$/);
    expect(a).not.toBe(b);
  });

  it("createEmptyPane defaults to a fresh id", () => {
    const p = createEmptyPane();
    expect(p.tabs).toEqual([]);
    expect(p.selectedTabId).toBeNull();
    expect(p.id).toMatch(/^pane-\d+$/);
  });

  it("findPane resolves by id", () => {
    const layout = createSinglePaneLayout([fileTab("t1")]);
    expect(findPane(layout, layout.panes[0].id)).toBe(layout.panes[0]);
    expect(findPane(layout, "missing")).toBeUndefined();
  });
});

describe("findTabOwner", () => {
  it("returns the pane + tab holding the given tab id", () => {
    const t1 = fileTab("t1");
    const t2 = fileTab("t2");
    const layout = buildLayout(
      "cols-2",
      [pane("pane-a", [t1]), pane("pane-b", [t2])],
      [[0, 1]],
    );
    expect(findTabOwner(layout, "t2")?.pane.id).toBe("pane-b");
    expect(findTabOwner(layout, "t2")?.tab.id).toBe("t2");
  });

  it("returns null when no pane holds the tab", () => {
    const layout = createSinglePaneLayout([fileTab("t1")]);
    expect(findTabOwner(layout, "missing")).toBeNull();
  });
});

describe("removeTabFromPane (Phase 6 steal helper)", () => {
  it("removes the tab and recomputes the pane's selectedTabId", () => {
    const t1 = fileTab("t1");
    const t2 = fileTab("t2");
    const layout = buildLayout("single", [pane("p", [t1, t2], "t2")], [[0]]);
    const next = removeTabFromPane(layout, "p", "t2");
    expect(next.panes[0].tabs.map((tab) => tab.id)).toEqual(["t1"]);
    // Selected tab was removed → falls back to the neighbor (t1).
    expect(next.panes[0].selectedTabId).toBe("t1");
  });

  it("leaves the pane empty (selectedTabId null) when removing the last tab (Q6)", () => {
    const t1 = fileTab("t1");
    const layout = buildLayout("single", [pane("p", [t1], "t1")], [[0]]);
    const next = removeTabFromPane(layout, "p", "t1");
    expect(next.panes[0].tabs).toEqual([]);
    expect(next.panes[0].selectedTabId).toBeNull();
  });

  it("preserves an unrelated selectedTabId when removing a non-selected tab", () => {
    const t1 = fileTab("t1");
    const t2 = fileTab("t2");
    const layout = buildLayout("single", [pane("p", [t1, t2], "t1")], [[0]]);
    const next = removeTabFromPane(layout, "p", "t2");
    expect(next.panes[0].selectedTabId).toBe("t1");
  });

  it("is a no-op when the pane or tab is missing", () => {
    const t1 = fileTab("t1");
    const layout = buildLayout("single", [pane("p", [t1], "t1")], [[0]]);
    expect(removeTabFromPane(layout, "missing", "t1")).toBe(layout);
    expect(removeTabFromPane(layout, "p", "missing")).toBe(layout);
  });
});

describe("moveTabBetweenPanes (Phase 5 tab→pane DnD)", () => {
  it("moves a tab across panes and focuses the destination", () => {
    const t1 = fileTab("t1");
    const t2 = fileTab("t2");
    const layout = buildLayout(
      "cols-2",
      [pane("a", [t1], "t1"), pane("b", [t2], "t2")],
      [[0, 1]],
      "a",
    );
    const next = moveTabBetweenPanes(layout, "a", "t1", "b", 0);
    expect(next.panes[0].tabs.map((tab) => tab.id)).toEqual([]);
    expect(next.panes[1].tabs.map((tab) => tab.id)).toEqual(["t1", "t2"]);
    // Destination selects the moved tab and becomes active.
    expect(next.panes[1].selectedTabId).toBe("t1");
    expect(next.activePaneId).toBe("b");
  });

  it("appends when toIndex equals the destination length (drop on empty pane)", () => {
    const t1 = fileTab("t1");
    const layout = buildLayout(
      "cols-2",
      [pane("a", [t1], "t1"), pane("b", [], null)],
      [[0, 1]],
      "a",
    );
    const next = moveTabBetweenPanes(layout, "a", "t1", "b", 5);
    expect(next.panes[1].tabs.map((tab) => tab.id)).toEqual(["t1"]);
    expect(next.panes[1].selectedTabId).toBe("t1");
  });

  it("reorders within the same pane (same from/to pane collapses to reorder)", () => {
    const t1 = fileTab("t1");
    const t2 = fileTab("t2");
    const t3 = fileTab("t3");
    const layout = buildLayout("single", [pane("p", [t1, t2, t3], "t1")], [[0]]);
    // Move t3 to index 0.
    const next = moveTabBetweenPanes(layout, "p", "t3", "p", 0);
    expect(next.panes[0].tabs.map((tab) => tab.id)).toEqual(["t3", "t1", "t2"]);
    expect(next.panes[0].selectedTabId).toBe("t3");
  });

  it("preserves the session-tab singleton (a session tab relocates, not duplicates)", () => {
    const s1 = sessionTab("s1", "agent-a");
    const layout = buildLayout(
      "cols-2",
      [pane("a", [s1], "s1"), pane("b", [], null)],
      [[0, 1]],
      "a",
    );
    const next = moveTabBetweenPanes(layout, "a", "s1", "b", 0);
    expect(next.panes[0].tabs).toEqual([]);
    expect(next.panes[1].tabs.map((tab) => tab.id)).toEqual(["s1"]);
  });

  it("recomputes the source pane's selectedTabId after the move", () => {
    const t1 = fileTab("t1");
    const t2 = fileTab("t2");
    const layout = buildLayout(
      "cols-2",
      [pane("a", [t1, t2], "t1"), pane("b", [], null)],
      [[0, 1]],
      "a",
    );
    const next = moveTabBetweenPanes(layout, "a", "t1", "b", 0);
    // t1 was the selected tab in a; after removal it falls back to t2.
    expect(next.panes[0].selectedTabId).toBe("t2");
  });

  it("is a no-op when the tab or either pane is missing", () => {
    const t1 = fileTab("t1");
    const layout = buildLayout(
      "cols-2",
      [pane("a", [t1], "t1"), pane("b", [], null)],
      [[0, 1]],
    );
    expect(moveTabBetweenPanes(layout, "missing", "t1", "b", 0)).toBe(layout);
    expect(moveTabBetweenPanes(layout, "a", "t1", "missing", 0)).toBe(layout);
    expect(moveTabBetweenPanes(layout, "a", "missing", "b", 0)).toBe(layout);
  });
});
