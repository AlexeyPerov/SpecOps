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
    // New panes receive implicit hidden drafts so typing can start immediately.
    expect(layout.panes[1].tabs).toHaveLength(1);
    expect(layout.panes[1].tabs[0]).toMatchObject({ stripHidden: true });
    expect(layout.panes[1].selectedTabId).toBeTruthy();
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

describe("editorLayoutSlice — moveTabBetweenPanes (Phase 5)", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("moves the active pane's tab into another pane and focuses the destination", () => {
    appState.setEditorLayout("cols-2");
    const layout = activeLayout();
    const sourcePaneId = layout.panes[0].id;
    const destPaneId = layout.panes[1].id;
    const movedTabId = layout.panes[0].tabs[0].id;

    appState.moveTabBetweenPanes(sourcePaneId, movedTabId, destPaneId, 0);

    const next = activeLayout();
    expect(next.panes[0].tabs.map((tab) => tab.id)).not.toContain(movedTabId);
    expect(next.panes[1].tabs.map((tab) => tab.id)).toContain(movedTabId);
    expect(next.activePaneId).toBe(destPaneId);
    expect(next.panes[1].selectedTabId).toBe(movedTabId);
  });

  it("appends when dropping on an empty pane", () => {
    appState.setEditorLayout("cols-2");
    const layout = activeLayout();
    const sourcePaneId = layout.panes[0].id;
    const destPaneId = layout.panes[1].id;
    const movedTabId = layout.panes[0].tabs[0].id;
    const destDraftTabId = layout.panes[1].tabs[0].id;

    appState.moveTabBetweenPanes(sourcePaneId, movedTabId, destPaneId, 99);

    const next = activeLayout();
    expect(next.panes[1].tabs.map((tab) => tab.id)).toEqual([destDraftTabId, movedTabId]);
  });

  it("is a no-op for an unknown source pane", () => {
    appState.setEditorLayout("cols-2");
    const before = activeLayout();
    appState.moveTabBetweenPanes("missing", "nope", before.panes[1].id, 0);
    expect(activeLayout()).toBe(before);
  });
});

describe("documentContentSlice — openFileInPane (Phase 6)", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("opens a fresh file into an empty pane and focuses it", () => {
    appState.setEditorLayout("cols-2");
    const destPaneId = activeLayout().panes[1].id;

    const docId = appState.openFileInPane("/tmp/alpha.txt", "alpha", destPaneId);

    expect(docId).not.toBe("");
    const next = activeLayout();
    const destPane = next.panes[1];
    expect(destPane.tabs).toHaveLength(2);
    expect(destPane.tabs.some((tab) => tab.kind === "file" && tab.documentId === docId)).toBe(
      true,
    );
    expect(next.activePaneId).toBe(destPaneId);
    expect(destPane.selectedTabId).toBe(
      destPane.tabs.find((tab) => tab.kind === "file" && tab.documentId === docId)?.id,
    );
  });

  it("steals an already-open file from another pane into the target (Q9)", () => {
    appState.setEditorLayout("cols-2");
    const layout = activeLayout();
    const sourcePaneId = layout.panes[0].id;
    const destPaneId = layout.panes[1].id;

    // Open the file in the source pane first.
    const sourceDocId = appState.openFileInPane("/tmp/beta.txt", "beta", sourcePaneId);
    expect(sourceDocId).not.toBe("");
    const sourceTabs = activeLayout().panes[0].tabs;
    const betaTab = sourceTabs.find(
      (tab): tab is import("../../domain/contracts").FileTabState =>
        tab.kind === "file" && tab.documentId === sourceDocId,
    );
    expect(betaTab).toBeDefined();
    const sourceTabId = betaTab!.id;

    // Drag-drop the same file into the destination pane.
    const docId = appState.openFileInPane("/tmp/beta.txt", "beta-updated", destPaneId);

    expect(docId).toBe(sourceDocId);
    const next = activeLayout();
    // Source pane no longer holds the tab.
    expect(next.panes[0].tabs.some((tab) => tab.id === sourceTabId)).toBe(false);
    // Destination pane now holds it, focused.
    expect(
      next.panes[1].tabs.some((tab) => tab.kind === "file" && tab.documentId === sourceDocId),
    ).toBe(true);
    expect(next.activePaneId).toBe(destPaneId);
  });

  it("focuses the existing tab when the file is already in the target pane", () => {
    appState.setEditorLayout("cols-2");
    const destPaneId = activeLayout().panes[1].id;

    appState.openFileInPane("/tmp/gamma.txt", "gamma", destPaneId);
    const gammaDocId = appState.findDocumentIdByPath("/tmp/gamma.txt");
    const existingTabId = activeLayout()
      .panes[1].tabs.find(
        (tab): tab is import("../../domain/contracts").FileTabState =>
          tab.kind === "file" && tab.documentId === gammaDocId,
      )?.id;
    expect(existingTabId).toBeTruthy();

    // Open another file into the source pane to move focus away.
    const sourcePaneId = activeLayout().panes[0].id;
    appState.openFileInPane("/tmp/delta.txt", "delta", sourcePaneId);

    // Re-open gamma in the dest pane: no new tab, just focused.
    appState.openFileInPane("/tmp/gamma.txt", "gamma-again", destPaneId);

    const next = activeLayout();
    expect(
      next.panes[1].tabs.filter(
        (tab) => tab.kind === "file" && tab.documentId === gammaDocId,
      ),
    ).toHaveLength(1);
    expect(next.activePaneId).toBe(destPaneId);
    expect(next.panes[1].selectedTabId).toBe(existingTabId);
  });
});
