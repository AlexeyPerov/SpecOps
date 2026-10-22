import { beforeEach, describe, expect, it, vi } from "vitest";
import { allTabs, createFileTab, createSinglePaneLayout, DEFAULT_TAB_GROUP_ID, getSessionSelectedTabId, tabDocumentId } from "../../domain/contracts";
import type { ContextSnapshot } from "../../domain/contracts";
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

  it("adopts a workspace with colliding ids while retaining dirty buffers, pane selection, and native session references", () => {
    const id = appState.addWorkspace('/incoming')!;
    const incoming = structuredClone(appState.getSnapshot().contexts.workspaces.find(entry => entry.id === id)!);
    const document = incoming.snapshot.documents[0];
    document.content = 'unsaved text'; document.savedContent = 'saved text'; document.isDirty = true;
    document.scrollTop = 432;
    const layout = incoming.snapshot.session.editorLayout;
    const fileTab = layout.panes[0].tabs[0];
    layout.panes.push({ id: 'pane-77', selectedTabId: 'tab-77', tabs: [{ id: 'tab-77', kind: 'session', sessionId: 'session-99', pinned: true }] });
    layout.kind = 'cols-2'; layout.slots = [[0, 1]]; layout.activePaneId = 'pane-77';
    appState.resetAppState();
    appState.addWorkspace('/existing');
    const existing = structuredClone(appState.getSnapshot().contexts.workspaces[0]);
    const adoptedId = appState.adoptWorkspace(incoming, 'window-2');
    const state = appState.getSnapshot();
    expect(state.contexts.workspaces[0]).toEqual(existing);
    const adopted = state.contexts.workspaces[1];
    expect(adoptedId).not.toBe(existing.id);
    expect(adopted.snapshot.documents[0]).toMatchObject({ content: 'unsaved text', savedContent: 'saved text', isDirty: true, scrollTop: 432 });
    expect(adopted.snapshot.documents[0].id).not.toBe(existing.snapshot.documents[0].id);
    const transferredLayout = adopted.snapshot.session.editorLayout;
    expect(transferredLayout.slots).toEqual([[0, 1]]);
    expect(transferredLayout.activePaneId).toBe(transferredLayout.panes[1].id);
    expect(transferredLayout.panes[1].tabs[0]).toMatchObject({ kind: 'session', sessionId: 'session-99', pinned: true });
    expect(transferredLayout.panes[0].tabs[0].id).not.toBe(fileTab.id);
    expect(adopted.snapshot.session.lastActiveWindowId).toBe('window-2');
  });

  it("restores active workspace context, order, tabs, and project panel state", () => {
    appState.applyWindowSession(
      {
        activeContextId: "ws-2",
        tabGroups: [{ id: "tabs-default", name: "Tabs", snapshot: {
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
        } }],
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
    const restoredLayout = snapshot.tabGroups[0].snapshot.session.editorLayout;

    snapshot.tabGroups[0].snapshot.session.editorLayout = {
      ...restoredLayout,
      activePaneId: activePane.id,
      panes: restoredLayout.panes.map((pane) =>
        pane.id === activePane.id ? { ...pane, tabs: [], selectedTabId: null } : pane,
      ),
    };

    appState.applyWindowSession(snapshot);

    const restored = appState.getSnapshot().contexts.tabGroups[0].snapshot;
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

    appState.switchContext("tabs-default");
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

  it("switches to the default tab group when closing the last active workspace", () => {
    const workspace = appState.addWorkspace("/tmp/ws")!;

    expect(appState.closeWorkspace(workspace)).toBe(true);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("tabs-default");
  });
});

describe("window tab groups", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  function groupSnapshot(docId: string, tabId: string, title: string): ContextSnapshot {
    return {
      documents: [
        {
          id: docId,
          filePath: null,
          title,
          content: title,
          savedContent: "",
          isDirty: true,
          contentKind: "text",
          language: "plaintext",
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
        editorLayout: createSinglePaneLayout([createFileTab(tabId, docId)], tabId),
        lastActiveWindowId: "main",
        windowBounds: null,
      },
    };
  }

  it("starts with only the default tab group active", () => {
    const { contexts } = appState.getSnapshot();
    expect(contexts.activeContextId).toBe(DEFAULT_TAB_GROUP_ID);
    expect(contexts.tabGroups.map((group) => group.id)).toEqual([DEFAULT_TAB_GROUP_ID]);
  });

  it("restores additional groups after the default group and keeps the active group", () => {
    appState.applyWindowSession({
      activeContextId: "tabs-2",
      tabGroups: [
        { id: "tabs-2", name: "Drafts", snapshot: groupSnapshot("doc-2", "tab-2", "draft") },
        { id: DEFAULT_TAB_GROUP_ID, name: "Tabs", snapshot: groupSnapshot("doc-1", "tab-1", "scratch") },
      ],
      workspaces: [],
      editorPreferences: { zoomPercent: 100, wrapLines: true },
    });

    const state = appState.getSnapshot();
    expect(state.contexts.tabGroups.map((group) => [group.id, group.name])).toEqual([
      [DEFAULT_TAB_GROUP_ID, "Tabs"],
      ["tabs-2", "Drafts"],
    ]);
    expect(state.contexts.activeContextId).toBe("tabs-2");
    expect(appState.isTabGroupActive()).toBe(true);
    expect(appState.getWorkspaceRoot()).toBeNull();
    expect(appState.getActiveDocuments().map((doc) => doc.content)).toEqual(["draft"]);
    expect(appState.getWindowSessionSnapshot().tabGroups.map((group) => group.id)).toEqual([
      DEFAULT_TAB_GROUP_ID,
      "tabs-2",
    ]);
  });

  it("recreates a missing default group and falls back to it for an unknown active id", () => {
    appState.applyWindowSession({
      activeContextId: "tabs-9",
      tabGroups: [{ id: "tabs-2", name: "Drafts", snapshot: groupSnapshot("doc-2", "tab-2", "draft") }],
      workspaces: [],
      editorPreferences: { zoomPercent: 100, wrapLines: true },
    });

    const state = appState.getSnapshot();
    expect(state.contexts.tabGroups.map((group) => group.id)).toEqual([DEFAULT_TAB_GROUP_ID, "tabs-2"]);
    expect(state.contexts.activeContextId).toBe(DEFAULT_TAB_GROUP_ID);
    expect(allTabs(state.contexts.tabGroups[0].snapshot.session.editorLayout)).toHaveLength(1);
  });

  it("switches between groups and edits only the active group", () => {
    appState.applyWindowSession({
      activeContextId: DEFAULT_TAB_GROUP_ID,
      tabGroups: [
        { id: DEFAULT_TAB_GROUP_ID, name: "Tabs", snapshot: groupSnapshot("doc-1", "tab-1", "scratch") },
        { id: "tabs-2", name: "Drafts", snapshot: groupSnapshot("doc-2", "tab-2", "draft") },
      ],
      workspaces: [],
      editorPreferences: { zoomPercent: 100, wrapLines: true },
    });

    expect(appState.switchContext("tabs-2")).toBe(true);
    appState.setDocumentContent("doc-2", "edited draft");

    const [defaultGroup, drafts] = appState.getSnapshot().contexts.tabGroups;
    expect(drafts.snapshot.documents[0].content).toBe("edited draft");
    expect(defaultGroup.snapshot.documents[0].content).toBe("scratch");
    expect(appState.switchContext("tabs-404")).toBe(false);
  });
});
