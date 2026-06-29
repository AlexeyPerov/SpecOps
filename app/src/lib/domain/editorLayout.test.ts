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
  getSessionSelectedTabId,
  getSessionTabs,
  layoutFromFlatTabs,
  mergePaneTabs,
  nextPaneId,
  normalizeEditorLayout,
  presetSlots,
  reflowAfterClose,
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
