import { describe, expect, it } from "vitest";
import {
  createFileTab,
  createSessionTab,
  createViewTab,
} from "../domain/contracts";
import {
  appendTabToPane,
  createEmptyPane,
  createSinglePaneLayout,
  setActivePaneInLayout,
  type EditorLayout,
  type SessionState,
} from "../domain/contracts";
import type { TabState } from "../domain/contracts";
import {
  activeViewKind,
  activeViewKindInActivePane,
  activeViewKindInPane,
  isSessionEditorPaneActive,
  isSessionTabActiveInActivePane,
  isSessionTabActiveInPane,
} from "./editorRouting";

/** Build a SessionState whose editorLayout is a single pane holding `tabs`. */
function singlePaneSession(tabs: TabState[], selectedTabId: string | null): SessionState {
  return {
    editorLayout: createSinglePaneLayout(tabs, selectedTabId),
    lastActiveWindowId: "main",
    windowBounds: null,
  };
}

describe("editor routing", () => {
  it("shows chat pane when an agent tab is selected", () => {
    const tabs = [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")];
    expect(isSessionEditorPaneActive(tabs, "tab-1")).toBe(false);
    expect(isSessionEditorPaneActive(tabs, "tab-2")).toBe(true);
  });

  it("does not show chat pane when selection is missing", () => {
    const tabs = [createSessionTab("tab-1", "agent-a")];
    expect(isSessionEditorPaneActive(tabs, null)).toBe(false);
    expect(isSessionEditorPaneActive(tabs, "tab-missing")).toBe(false);
  });

  describe("activeViewKind", () => {
    it("returns the view kind when a view tab is selected", () => {
      const tabs = [
        createFileTab("tab-1", "doc-1"),
        createViewTab("tab-2", "settings"),
        createViewTab("tab-3", "themes"),
      ];
      expect(activeViewKind(tabs, "tab-2")).toBe("settings");
      expect(activeViewKind(tabs, "tab-3")).toBe("themes");
    });

    it("returns null for file/session tabs and missing selection", () => {
      const tabs = [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")];
      expect(activeViewKind(tabs, "tab-1")).toBeNull();
      expect(activeViewKind(tabs, "tab-2")).toBeNull();
      expect(activeViewKind(tabs, null)).toBeNull();
      expect(activeViewKind(tabs, "tab-missing")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — active-pane entry points. "The editor pane" is now the active pane
// of the context's EditorLayout; its selected tab is derived via
// getSessionActiveTab (activePane → activeTab, Q15).
// ---------------------------------------------------------------------------

describe("active-pane routing (split view)", () => {
  describe("isSessionTabActiveInActivePane", () => {
    it("is true when the active pane's selected tab is a session tab", () => {
      const session = singlePaneSession(
        [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")],
        "tab-2",
      );
      expect(isSessionTabActiveInActivePane(session)).toBe(true);
    });

    it("is false when the active pane's selected tab is a file tab", () => {
      const session = singlePaneSession(
        [createFileTab("tab-1", "doc-1"), createSessionTab("tab-2", "agent-a")],
        "tab-1",
      );
      expect(isSessionTabActiveInActivePane(session)).toBe(false);
    });

    it("is false when the active pane has no selection / is empty", () => {
      const empty: EditorLayout = {
        kind: "single",
        panes: [createEmptyPane("pane-1")],
        slots: [[0]],
        activePaneId: "pane-1",
      };
      const session: SessionState = {
        editorLayout: empty,
        lastActiveWindowId: "main",
        windowBounds: null,
      };
      expect(isSessionTabActiveInActivePane(session)).toBe(false);
    });

    it("reads off the ACTIVE pane in a multi-pane layout, not pane #1", () => {
      // Two panes: pane-1 holds a file tab (selected), pane-2 holds a session
      // tab (selected). The active pane is pane-2.
      let layout: EditorLayout = createSinglePaneLayout(
        [createFileTab("tab-file", "doc-1")],
        "tab-file",
      );
      // Rename the seeded pane for clarity and append a second pane.
      layout = {
        ...layout,
        panes: [
          { ...layout.panes[0]!, id: "pane-1" },
          { id: "pane-2", tabs: [createSessionTab("tab-session", "agent-a")], selectedTabId: "tab-session" },
        ],
        slots: [[0, 1]],
        activePaneId: "pane-2",
      };
      const session: SessionState = {
        editorLayout: layout,
        lastActiveWindowId: "main",
        windowBounds: null,
      };
      expect(isSessionTabActiveInActivePane(session)).toBe(true);

      // Switching the active pane to pane-1 (file tab) must flip the result.
      const onFile: SessionState = {
        ...session,
        editorLayout: setActivePaneInLayout(session.editorLayout, "pane-1"),
      };
      expect(isSessionTabActiveInActivePane(onFile)).toBe(false);
    });
  });

  describe("activeViewKindInActivePane", () => {
    it("returns the view kind of the active pane's selected view tab", () => {
      const settings = singlePaneSession(
        [createFileTab("tab-1", "doc-1"), createViewTab("tab-2", "settings")],
        "tab-2",
      );
      expect(activeViewKindInActivePane(settings)).toBe("settings");

      const themes = singlePaneSession(
        [createFileTab("tab-1", "doc-1"), createViewTab("tab-3", "themes")],
        "tab-3",
      );
      expect(activeViewKindInActivePane(themes)).toBe("themes");
    });

    it("returns null for file/session tabs and empty panes", () => {
      const fileSession = singlePaneSession([createFileTab("tab-1", "doc-1")], "tab-1");
      expect(activeViewKindInActivePane(fileSession)).toBeNull();

      const sessionTab = singlePaneSession(
        [createSessionTab("tab-1", "agent-a")],
        "tab-1",
      );
      expect(activeViewKindInActivePane(sessionTab)).toBeNull();

      const empty: EditorLayout = {
        kind: "single",
        panes: [createEmptyPane("pane-1")],
        slots: [[0]],
        activePaneId: "pane-1",
      };
      expect(
        activeViewKindInActivePane({
          editorLayout: empty,
          lastActiveWindowId: "main",
          windowBounds: null,
        }),
      ).toBeNull();
    });

    it("reads off the ACTIVE pane in a multi-pane layout", () => {
      // pane-1: settings view tab selected; pane-2: file tab selected.
      // Active pane is pane-2, so the view kind must be null.
      let layout: EditorLayout = createSinglePaneLayout(
        [createViewTab("tab-settings", "settings")],
        "tab-settings",
      );
      layout = {
        ...layout,
        panes: [
          { ...layout.panes[0]!, id: "pane-1" },
          {
            id: "pane-2",
            tabs: [createFileTab("tab-file", "doc-1")],
            selectedTabId: "tab-file",
          },
        ],
        slots: [[0, 1]],
        activePaneId: "pane-2",
      };
      const activeIsFile: SessionState = {
        editorLayout: layout,
        lastActiveWindowId: "main",
        windowBounds: null,
      };
      expect(activeViewKindInActivePane(activeIsFile)).toBeNull();

      // Focusing pane-1 surfaces the settings view kind.
      const activeIsSettings: SessionState = {
        ...activeIsFile,
        editorLayout: setActivePaneInLayout(layout, "pane-1"),
      };
      expect(activeViewKindInActivePane(activeIsSettings)).toBe("settings");
    });
  });

  it("appendTabToPane is exercised to confirm pane-aware helpers compose", () => {
    // Sanity that the active-pane routing helpers interoperate with the
    // pane-aware layout mutators used by the reducer (no implicit reliance on
    // a flat openTabs list).
    let layout = createSinglePaneLayout([createFileTab("tab-1", "doc-1")], "tab-1");
    layout = appendTabToPane(layout, createSessionTab("tab-2", "agent-a"));
    const session: SessionState = {
      editorLayout: layout,
      lastActiveWindowId: "main",
      windowBounds: null,
    };
    // appendTabToPane selects the appended tab in the active pane.
    expect(isSessionTabActiveInActivePane(session)).toBe(true);
  });

  describe("pane-scoped routing (F3-B)", () => {
    it("isSessionTabActiveInPane reads a specific pane, not the active pane", () => {
      const layout: EditorLayout = {
        kind: "cols-2",
        panes: [
          { id: "pane-1", tabs: [createFileTab("tab-1", "doc-1")], selectedTabId: "tab-1" },
          {
            id: "pane-2",
            tabs: [createSessionTab("tab-2", "agent-a")],
            selectedTabId: "tab-2",
          },
        ],
        slots: [[0, 1]],
        activePaneId: "pane-1",
      };
      expect(isSessionTabActiveInPane(layout, "pane-1")).toBe(false);
      expect(isSessionTabActiveInPane(layout, "pane-2")).toBe(true);
    });

    it("activeViewKindInPane resolves settings/themes per pane", () => {
      const layout: EditorLayout = {
        kind: "cols-2",
        panes: [
          {
            id: "pane-1",
            tabs: [createViewTab("tab-1", "settings")],
            selectedTabId: "tab-1",
          },
          { id: "pane-2", tabs: [createFileTab("tab-2", "doc-1")], selectedTabId: "tab-2" },
        ],
        slots: [[0, 1]],
        activePaneId: "pane-2",
      };
      expect(activeViewKindInPane(layout, "pane-1")).toBe("settings");
      expect(activeViewKindInPane(layout, "pane-2")).toBeNull();
    });
  });
});
