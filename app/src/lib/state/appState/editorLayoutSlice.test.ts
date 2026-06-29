import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../appState";
import { getSessionSelectedTabId } from "../../domain/contracts";
import { saveThemeFile } from "../../services/themeStore";

vi.mock("../../services/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});

const saveThemeFileMock = vi.mocked(saveThemeFile);

function activeLayout() {
  return appState.getActiveSession().editorLayout;
}

describe("editorLayoutSlice — setEditorLayout presets", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("switches single → grid-2x2, creating empty panes and keeping the active one", () => {
    appState.setEditorLayout("grid-2x2");
    const layout = activeLayout();
    expect(layout.kind).toBe("grid-2x2");
    expect(layout.panes).toHaveLength(4);
    expect(layout.slots).toEqual([
      [0, 1],
      [2, 3],
    ]);
    // The original single pane survives as pane #1 with its tabs.
    expect(layout.panes[0].tabs.length).toBeGreaterThan(0);
    expect(layout.panes[1].tabs).toEqual([]);
  });

  it("cols-2 produces two side-by-side panes", () => {
    appState.setEditorLayout("cols-2");
    expect(activeLayout().slots).toEqual([[0, 1]]);
    expect(activeLayout().panes.length).toBe(2);
  });

  it("rows-3 produces three stacked panes", () => {
    appState.setEditorLayout("rows-3");
    expect(activeLayout().slots).toEqual([[0], [1], [2]]);
    expect(activeLayout().panes.length).toBe(3);
  });

  it("switching back to single merges orphaned panes into the active pane", () => {
    appState.setEditorLayout("grid-2x2");
    const beforeCount = activeLayout().panes[0].tabs.length;
    appState.setEditorLayout("single");
    const layout = activeLayout();
    expect(layout.kind).toBe("single");
    expect(layout.panes).toHaveLength(1);
    // No tabs lost: the single pane holds at least what it had before splitting.
    expect(layout.panes[0].tabs.length).toBeGreaterThanOrEqual(beforeCount);
  });

  it("is a no-op when the kind already matches", () => {
    const before = activeLayout();
    appState.setEditorLayout("single");
    expect(activeLayout()).toBe(before);
  });
});

describe("editorLayoutSlice — closeEditorPane reflow", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("4 → 3 produces the 2-over-1 custom shape", () => {
    appState.setEditorLayout("grid-2x2");
    const firstPaneId = activeLayout().panes[2].id; // bottom-left
    appState.closeEditorPane(firstPaneId);
    const layout = activeLayout();
    expect(layout.kind).toBe("custom");
    expect(layout.slots).toEqual([[0, 1], [2]]);
    expect(layout.panes).toHaveLength(3);
  });

  it("3 → 2 snaps to cols-2", () => {
    appState.setEditorLayout("grid-2x2");
    appState.closeEditorPane(activeLayout().panes[2].id);
    expect(activeLayout().kind).toBe("custom");
    // Close one of the two top panes -> drops to 2 panes -> cols-2.
    appState.closeEditorPane(activeLayout().panes[0].id);
    const layout = activeLayout();
    expect(layout.kind).toBe("cols-2");
    expect(layout.slots).toEqual([[0, 1]]);
    expect(layout.panes).toHaveLength(2);
  });

  it("2 → 1 snaps to single", () => {
    appState.setEditorLayout("cols-2");
    appState.closeEditorPane(activeLayout().panes[1].id);
    const layout = activeLayout();
    expect(layout.kind).toBe("single");
    expect(layout.panes).toHaveLength(1);
  });

  it("refuses to close the last pane", () => {
    const before = activeLayout();
    appState.closeEditorPane(activeLayout().panes[0].id);
    expect(activeLayout()).toBe(before);
  });
});

describe("editorLayoutSlice — pane focus", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("setActiveEditorPane moves focus to the named pane", () => {
    appState.setEditorLayout("cols-2");
    const secondId = activeLayout().panes[1].id;
    appState.setActiveEditorPane(secondId);
    expect(activeLayout().activePaneId).toBe(secondId);
  });

  it("setActiveEditorPaneBySlot focuses the Nth pane in slot order", () => {
    appState.setEditorLayout("grid-2x2");
    const expectedId = activeLayout().panes[2].id; // slot 3 (1-based) = bottom-left
    appState.setActiveEditorPaneBySlot(3);
    expect(activeLayout().activePaneId).toBe(expectedId);
  });

  it("setActiveEditorPaneBySlot ignores an out-of-range slot", () => {
    appState.setEditorLayout("cols-2");
    const before = activeLayout().activePaneId;
    appState.setActiveEditorPaneBySlot(9);
    expect(activeLayout().activePaneId).toBe(before);
  });
});

describe("editorLayoutSlice — selection survives layout changes", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("the active pane's selected tab is preserved across a preset round-trip", () => {
    const selectedBefore = getSessionSelectedTabId(appState.getActiveSession());
    appState.setEditorLayout("cols-2");
    appState.setEditorLayout("single");
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe(selectedBefore);
  });
});

describe("editorLayoutSlice — test isolation", () => {
  // sanity: saveThemeFile mock is in place (keeps persistence silent in tests).
  it("theme save mock is active", () => {
    expect(saveThemeFileMock).toBeDefined();
  });
});
