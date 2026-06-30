import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFileTab, createSessionTab, createSinglePaneLayout, getSessionSelectedTabId, getSessionTabs, isFileTab, isSessionTab, isViewTab, tabDocumentId } from "../../domain/contracts";
import { appState, resetThemePersistenceForTests, setThemeSaveErrorNotifier } from "../appState";
import { saveThemeFile } from "../../services/themeStore";
import {
  defaultProviderModelCatalogs,
  getProviderDefaultModelId,
} from "../../ai/providers/providerModelCatalog";

vi.mock("../../services/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});

const saveThemeFileMock = vi.mocked(saveThemeFile);

describe("appState tabs and selection", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("createTab adds a document and selects it", () => {
    appState.createTab();
    const snapshot = appState.getSnapshot();
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
    expect(appState.getActiveDocuments()).toHaveLength(2);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("selectTab ignores unknown tab ids", () => {
    appState.selectTab("tab-missing");
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-1");
  });

  it("openOrFocusSessionTab opens a new agent tab and focuses an existing one", () => {
    appState.openOrFocusSessionTab("agent-a");
    let snapshot = appState.getSnapshot();
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
    const firstAgentTab = getSessionTabs(appState.getActiveSession()).find((tab) => isSessionTab(tab) && tab.sessionId === "agent-a");
    expect(firstAgentTab?.id).toBe("tab-2");
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");

    appState.selectTab("tab-1");
    appState.openOrFocusSessionTab("agent-a");
    snapshot = appState.getSnapshot();
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("openOrFocusViewTab opens a singleton view tab and focuses an existing one", () => {
    appState.openOrFocusViewTab("settings", "connections");
    const settingsTabs = () =>
      getSessionTabs(appState.getActiveSession()).filter(
        (tab): tab is import("../../domain/contracts").ViewTabState =>
          isViewTab(tab) && tab.view === "settings",
      );
    expect(settingsTabs()).toHaveLength(1);
    const firstSettingsTab = settingsTabs()[0];
    expect(firstSettingsTab.subTab).toBe("connections");
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe(firstSettingsTab.id);

    // Selecting away and re-opening must focus, not duplicate.
    appState.selectTab("tab-1");
    appState.openOrFocusViewTab("settings");
    expect(settingsTabs()).toHaveLength(1);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe(firstSettingsTab.id);

    // A different view opens as a separate tab.
    appState.openOrFocusViewTab("themes");
    const themesTabs = getSessionTabs(appState.getActiveSession()).filter((tab) => isViewTab(tab) && tab.view === "themes");
    expect(themesTabs).toHaveLength(1);
  });

  it("closeTabsForSession removes all tabs for that agent", () => {
    appState.openOrFocusSessionTab("agent-a");
    appState.openOrFocusSessionTab("agent-b");
    appState.closeTabsForSession("agent-a");

    const snapshot = appState.getSnapshot();
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => isSessionTab(tab) && tab.sessionId === "agent-a")).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => isSessionTab(tab) && tab.sessionId === "agent-b")).toBe(true);
  });

  it("closeTabForce focuses the next open agent tab in tab-bar order", () => {
    appState.openOrFocusSessionTab("agent-a");
    appState.openOrFocusSessionTab("agent-b");
    const agentATabId = getSessionTabs(appState.getActiveSession()).find((tab) => isSessionTab(tab) && tab.sessionId === "agent-a")?.id;
    expect(agentATabId).toBeDefined();
    appState.selectTab(agentATabId!);

    appState.closeTabForce(agentATabId!);

    const snapshot = appState.getSnapshot();
    const selected = getSessionTabs(appState.getActiveSession()).find((tab) => tab.id === getSessionSelectedTabId(appState.getActiveSession()));
    expect(selected && isSessionTab(selected) ? selected.sessionId : null).toBe("agent-b");
  });

  it("persists lastActiveSessionId in session state", () => {
    appState.setLastActiveSessionId("agent-a");
    expect(appState.getActiveSession().lastActiveSessionId).toBe("agent-a");
    appState.setLastActiveSessionId(null);
    expect(appState.getActiveSession().lastActiveSessionId).toBeNull();
  });

  it("selectOrReopenTabForDocument selects an open tab", () => {
    appState.createTab();
    appState.selectTab("tab-1");
    appState.selectOrReopenTabForDocument("doc-2");
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("selectOrReopenTabForDocument reopens a closed document in a new tab", () => {
    appState.openFileInTab("/tmp/notes.txt", "notes");
    const documentId = appState.findDocumentIdByPath("/tmp/notes.txt");
    expect(documentId).not.toBeNull();
    appState.closeTabForce("tab-2");
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);

    appState.selectOrReopenTabForDocument(documentId!);
    const snapshot = appState.getSnapshot();
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-3");
  });

  it("closeTab cannot remove the last remaining tab", () => {
    appState.closeTab("tab-1");
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);
  });

  it("closeTab removes a tab from a non-active pane", () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const otherPane = layout.panes.find((pane) => pane.id !== layout.activePaneId)!;
    appState.openFileInPane("/tmp/other-pane.txt", "other", otherPane.id);
    const otherTabId =
      appState.getActiveSession().editorLayout.panes.find((pane) => pane.id === otherPane.id)
        ?.tabs[1]?.id ?? null;
    expect(otherTabId).toBeTruthy();
    appState.closeTab(otherTabId!);
    const otherPaneAfter = appState
      .getActiveSession()
      .editorLayout.panes.find((pane) => pane.id === otherPane.id)!;
    expect(otherPaneAfter.tabs.some((tab) => tab.id === otherTabId)).toBe(false);
  });

  it("closeTabForce creates a hidden implicit draft when the last empty untitled closes", () => {
    appState.closeTabForce("tab-1");
    const tabs = getSessionTabs(appState.getActiveSession());
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ stripHidden: true });
    expect(appState.getActiveDocuments()[0]?.title).toBe("Untitled");
  });

  it("createTab adds a visible tab immediately", () => {
    appState.createTab();
    const tabs = getSessionTabs(appState.getActiveSession());
    const created = tabs.find((tab) => tab.id === "tab-2");
    expect(created && isFileTab(created) ? created.stripHidden : undefined).not.toBe(true);
  });

  it("closeTabWithPrompt closes a non-selected dirty tab when confirmed", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.setDocumentContent("doc-2", "a dirty");
    const confirm = vi.fn(() => true);

    const closed = appState.closeTabWithPrompt("tab-2", confirm);

    expect(closed).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Close a.txt without saving?");
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.id === "tab-2")).toBe(false);
  });

  it("closeOtherTabs keeps context tab and skips pinned tabs", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");

    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      notepad: {
        ...appState.getWindowSessionSnapshot().notepad,
        session: {
          ...appState.getWindowSessionSnapshot().notepad.session,
          editorLayout: createSinglePaneLayout(
            [
              createFileTab("tab-1", "doc-1"),
              createFileTab("tab-2", "doc-2"),
              createFileTab("tab-3", "doc-3", true),
              createFileTab("tab-4", "doc-4"),
            ],
            "tab-4",
          ),
        },
      },
    });

    const closed = appState.closeOtherTabs("tab-2", () => true);

    expect(closed).toBe(true);
    const snapshot = appState.getSnapshot();
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(["tab-2", "tab-3"]);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("closeOtherTabs aborts when a dirty tab is rejected", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.setDocumentContent("doc-3", "dirty");
    const before = getSessionTabs(appState.getActiveSession()).map((tab) => tab.id);

    const closed = appState.closeOtherTabs("tab-2", () => false);

    expect(closed).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(before);
  });

  it("closeTabsToRight closes only right-side unpinned tabs", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");

    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      notepad: {
        ...appState.getWindowSessionSnapshot().notepad,
        session: {
          ...appState.getWindowSessionSnapshot().notepad.session,
          editorLayout: createSinglePaneLayout(
            [
              createFileTab("tab-1", "doc-1"),
              createFileTab("tab-2", "doc-2"),
              createFileTab("tab-3", "doc-3"),
              createFileTab("tab-4", "doc-4", true),
              createFileTab("tab-5", "doc-5"),
            ],
            "tab-3",
          ),
        },
      },
    });

    const closed = appState.closeTabsToRight("tab-2", () => true);

    expect(closed).toBe(true);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual([
      "tab-1",
      "tab-2",
      "tab-4",
    ]);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("closeMissingFileTabs closes missing tabs without prompt and keeps pinned missing", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");

    const currentSnapshot = appState.getWindowSessionSnapshot();
    appState.applyWindowSession({
      ...currentSnapshot,
      notepad: {
        ...currentSnapshot.notepad,
        documents: currentSnapshot.notepad.documents.map((doc) =>
          doc.id === "doc-2" || doc.id === "doc-3"
            ? { ...doc, fileMissing: true }
            : doc,
        ),
        session: {
          ...currentSnapshot.notepad.session,
          editorLayout: createSinglePaneLayout(
            [
              createFileTab("tab-1", "doc-1"),
              createFileTab("tab-2", "doc-2"),
              createFileTab("tab-3", "doc-3", true),
            ],
            "tab-2",
          ),
        },
      },
    });

    const closed = appState.closeMissingFileTabs();

    expect(closed).toBe(true);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(["tab-1", "tab-3"]);
  });

  it("closeMissingFileTabs keeps one Untitled tab when all tabs close", () => {
    const currentSnapshot = appState.getWindowSessionSnapshot();
    appState.applyWindowSession({
      ...currentSnapshot,
      notepad: {
        ...currentSnapshot.notepad,
        documents: currentSnapshot.notepad.documents.map((doc) => ({ ...doc, fileMissing: true })),
      },
    });

    const closed = appState.closeMissingFileTabs();
    const snapshot = appState.getSnapshot();

    expect(closed).toBe(true);
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);
    const selectedTab = getSessionTabs(appState.getActiveSession())[0];
    expect(selectedTab).toBeDefined();
    expect(appState.getActiveDocuments().find((doc) => doc.id === tabDocumentId(selectedTab))?.title).toBe("Untitled");
  });

  it("reorderTabs moves tabs and ignores invalid indices", () => {
    appState.createTab();
    appState.reorderTabs(1, 0);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual([
      "tab-2",
      "tab-1",
    ]);

    appState.reorderTabs(-1, 0);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual([
      "tab-2",
      "tab-1",
    ]);
  });

  it("reorderWorkspaces moves workspaces and ignores invalid indices", () => {
    appState.addWorkspace("/tmp/ws-a");
    const wsAId = appState.getSnapshot().contexts.workspaces[0]?.id;
    appState.addWorkspace("/tmp/ws-b");
    const wsBId = appState.getSnapshot().contexts.workspaces[1]?.id;
    const activeBefore = appState.getSnapshot().contexts.activeContextId;

    appState.reorderWorkspaces(1, 0);
    expect(appState.getSnapshot().contexts.workspaces.map((workspace) => workspace.rootPath)).toEqual([
      "/tmp/ws-b",
      "/tmp/ws-a",
    ]);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(activeBefore);

    appState.reorderWorkspaces(-1, 0);
    expect(appState.getSnapshot().contexts.workspaces.map((workspace) => workspace.rootPath)).toEqual([
      "/tmp/ws-b",
      "/tmp/ws-a",
    ]);

    appState.switchContext(wsAId!);
    appState.reorderWorkspaces(0, 1);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(wsAId);
    expect(appState.getSnapshot().contexts.workspaces.map((workspace) => workspace.id)).toEqual([
      wsAId,
      wsBId,
    ]);
  });

  it("addWorkspace appends to end after manual reorder", () => {
    appState.addWorkspace("/tmp/ws-first");
    appState.addWorkspace("/tmp/ws-second");
    appState.reorderWorkspaces(1, 0);
    appState.addWorkspace("/tmp/ws-third");

    expect(appState.getSnapshot().contexts.workspaces.map((workspace) => workspace.rootPath)).toEqual([
      "/tmp/ws-second",
      "/tmp/ws-first",
      "/tmp/ws-third",
    ]);
  });

  it("buildTabTransferPayload reads tab data without closing", () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    expect(appState.buildTabTransferPayload(tabId)).toEqual({
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
  });

  it("removeTransferredTab closes the requested tab", () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    appState.removeTransferredTab(tabId);
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);
  });

  it("removeTransferredTab seeds a hidden draft when the last tab is transferred out", () => {
    appState.resetAppState();
    appState.removeTransferredTab("tab-1");
    const tabs = getSessionTabs(appState.getActiveSession());
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ stripHidden: true });
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe(tabs[0]?.id);
  });

  it("openTransferredTab replaces bootstrap untitled in a fresh window", () => {
    appState.resetAppState();
    const documentId = appState.openTransferredTab({
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
    expect(documentId).toBe("doc-2");
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
    expect(appState.getActiveDocuments()).toHaveLength(1);
    expect(appState.getActiveDocuments()[0]?.filePath).toBe("/tmp/move-me.txt");
  });

  it("transferActiveTabOut and openTransferredTab round-trip tab payload", () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const transfer = appState.transferActiveTabOut();
    expect(transfer).toEqual({
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);

    const documentId = appState.openTransferredTab(transfer!);
    expect(documentId).toBe("doc-2");
    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-3");
  });
});

