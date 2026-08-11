import { beforeEach, describe, expect, it, vi } from "vitest";
import { allTabs, createFileTab, createSinglePaneLayout, getSessionSelectedTabId, tabDocumentId } from "../../domain/contracts";
import { appState, resetThemePersistenceForTests, setThemeSaveErrorNotifier } from "../appState";
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

describe("appState session restore", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("restores active workspace context, order, tabs, and project panel state", () => {
    appState.applyWindowSession(
      {
        activeContextId: "ws-2",
        notepad: {
          documents: [
            {
              id: "doc-1",
              filePath: "/tmp/notepad.md",
              title: "notepad.md",
              content: "notepad",
              savedContent: "notepad",
              isDirty: false,
              contentKind: "text",
              language: "markdown",
              encoding: "utf-8",
              lineEnding: "lf",
              diskFingerprint: null,
              dismissedFingerprint: null,
              fileMissing: false,
              scrollTop: 0,
              markdownViewMode: "edit",
            },
          ],
          session: {
            editorLayout: createSinglePaneLayout([createFileTab("tab-1", "doc-1")], "tab-1"),
            lastActiveWindowId: "main",
            windowBounds: null,
          },
        },
        workspaces: [
          {
            id: "ws-1",
            rootPath: "/tmp/ws-one",
            snapshot: {
              documents: [
                {
                  id: "doc-2",
                  filePath: "/tmp/ws-one/a.ts",
                  title: "a.ts",
                  content: "export const a = 1;",
                  savedContent: "export const a = 1;",
                  isDirty: false,
                  contentKind: "text",
                  language: "typescript",
                  encoding: "utf-8",
                  lineEnding: "lf",
                  diskFingerprint: null,
                  dismissedFingerprint: null,
                  fileMissing: false,
                  scrollTop: 0,
                  markdownViewMode: "edit",
                },
              ],
              session: {
                editorLayout: createSinglePaneLayout([createFileTab("tab-2", "doc-2")], "tab-2"),
                lastActiveWindowId: "main",
                windowBounds: null,
              },
            },
          },
          {
            id: "ws-2",
            rootPath: "/tmp/ws-two",
            snapshot: {
              documents: [
                {
                  id: "doc-3",
                  filePath: "/tmp/ws-two/b.ts",
                  title: "b.ts",
                  content: "export const b = 2;",
                  savedContent: "export const b = 2;",
                  isDirty: false,
                  contentKind: "text",
                  language: "typescript",
                  encoding: "utf-8",
                  lineEnding: "lf",
                  diskFingerprint: null,
                  dismissedFingerprint: null,
                  fileMissing: false,
                  scrollTop: 0,
                  markdownViewMode: "edit",
                },
              ],
              session: {
                editorLayout: createSinglePaneLayout([createFileTab("tab-3", "doc-3")], "tab-3"),
                lastActiveWindowId: "main",
                windowBounds: null,
                layout: {
                  projectPanelWidthPx: 320,
                  sessionsSidebarWidthPx: 280,
                  projectPanelCollapsed: true,
                  sessionsSidebarCollapsed: false,
                  expandedProjectTreePaths: [],
                },
              },
            },
          },
        ],
        editorPreferences: {
          zoomPercent: 120,
          wrapLines: false,
        },
      },
      ["/tmp/notepad.md"],
    );

    const snapshot = appState.getSnapshot();
    expect(snapshot.contexts.activeContextId).toBe("ws-2");
    expect(snapshot.contexts.workspaces.map((workspace) => workspace.id)).toEqual(["ws-1", "ws-2"]);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-3");
    expect(appState.getActiveDocuments()[0]?.filePath).toBe("/tmp/ws-two/b.ts");
    expect(appState.getActiveWorkspaceLayout().projectPanelCollapsed).toBe(true);
    expect(appState.getActiveWorkspaceLayout().projectPanelWidthPx).toBe(320);
  });

  it("keeps sibling-pane tabs when the restored active pane is empty", () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const activePane = layout.panes[0]!;
    const siblingPane = layout.panes[1]!;
    const documentId = appState.openFileInPane("/tmp/restore-sibling.txt", "saved", siblingPane.id);
    const snapshot = appState.getWindowSessionSnapshot();
    const restoredLayout = snapshot.notepad.session.editorLayout;

    snapshot.notepad.session.editorLayout = {
      ...restoredLayout,
      activePaneId: activePane.id,
      panes: restoredLayout.panes.map((pane) =>
        pane.id === activePane.id ? { ...pane, tabs: [], selectedTabId: null } : pane,
      ),
    };

    appState.applyWindowSession(snapshot);

    const restored = appState.getSnapshot().contexts.notepad;
    expect(restored.session.editorLayout.panes).toHaveLength(2);
    expect(allTabs(restored.session.editorLayout).some((tab) => tabDocumentId(tab) === documentId)).toBe(true);
    expect(restored.documents.some((document) => document.id === documentId)).toBe(true);
  });

  it("keeps per-workspace panel layout when switching workspaces", () => {
    appState.addWorkspace("/tmp/ws-one");
    appState.updateActiveWorkspaceLayout({
      projectPanelWidthPx: 300,
      sessionsSidebarWidthPx: 260,
      projectPanelCollapsed: true,
      sessionsSidebarCollapsed: false,
    });

    appState.addWorkspace("/tmp/ws-two");
    appState.updateActiveWorkspaceLayout({
      projectPanelWidthPx: 400,
      sessionsSidebarWidthPx: 360,
      projectPanelCollapsed: false,
      sessionsSidebarCollapsed: true,
    });

    const wsOneId = appState.getSnapshot().contexts.workspaces[0]?.id;
    expect(wsOneId).toBeDefined();
    appState.switchContext(wsOneId!);

    expect(appState.getActiveWorkspaceLayout().projectPanelWidthPx).toBe(300);
    expect(appState.getActiveWorkspaceLayout().sessionsSidebarWidthPx).toBe(260);
    expect(appState.getActiveWorkspaceLayout().projectPanelCollapsed).toBe(true);
    expect(appState.getActiveWorkspaceLayout().sessionsSidebarCollapsed).toBe(false);
  });

  it("keeps the activity-rail width across context switches (independent of mode/workspace)", () => {
    appState.setActivityRailWidth(220);
    expect(appState.getSnapshot().activityRailWidthPx).toBe(220);

    appState.addWorkspace("/tmp/ws-rail");
    expect(appState.getSnapshot().activityRailWidthPx).toBe(220);

    appState.switchContext("notepad");
    expect(appState.getSnapshot().activityRailWidthPx).toBe(220);

    appState.setActivityRailWidth(150);
    const wsId = appState.getSnapshot().contexts.workspaces[0]?.id!;
    appState.switchContext(wsId);
    expect(appState.getSnapshot().activityRailWidthPx).toBe(150);
  });

});

describe("closeWorkspace active-context selection", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("preserves the active workspace when closing a different workspace", () => {
    const workspaceA = appState.addWorkspace("/tmp/ws-a")!;
    const workspaceB = appState.addWorkspace("/tmp/ws-b")!;
    appState.switchContext(workspaceA);

    expect(appState.closeWorkspace(workspaceB)).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(workspaceA);
  });

  it("switches an active workspace to the first remaining workspace", () => {
    const workspaceA = appState.addWorkspace("/tmp/ws-a")!;
    const workspaceB = appState.addWorkspace("/tmp/ws-b")!;

    expect(appState.getSnapshot().contexts.activeContextId).toBe(workspaceB);
    expect(appState.closeWorkspace(workspaceB)).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(workspaceA);
  });

  it("switches to Notepad when closing the last active workspace", () => {
    const workspace = appState.addWorkspace("/tmp/ws")!;

    expect(appState.closeWorkspace(workspace)).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");
  });
});
