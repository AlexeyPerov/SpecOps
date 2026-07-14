import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFileTab, createSinglePaneLayout, getSessionSelectedTabId, getSessionTabs } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  closeOtherTabsWithUnsavedPrompt,
  closeTabWithUnsavedPrompt,
  closeTabsToLeftWithUnsavedPrompt,
  closeTabsToRightWithUnsavedPrompt,
} from "./closeTabFlow";
import { saveDocumentForClose } from "./documentSave";
import { promptUnsavedClose } from "./unsavedClosePrompt";

vi.mock("./unsavedClosePrompt", () => ({
  needsCloseConfirmation: vi.fn((document: { isDirty: boolean }) => document.isDirty),
  promptUnsavedClose: vi.fn(),
}));

vi.mock("./documentSave", () => ({
  saveDocumentForClose: vi.fn(),
}));

const deps = {
  getWindowId: () => "main",
  notify: vi.fn(),
};

function applyPinnedTabs(): void {
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
}

describe("closeTabWithUnsavedPrompt", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(promptUnsavedClose).mockReset();
    vi.mocked(saveDocumentForClose).mockReset();
  });

  it("closes a clean tab without prompting", async () => {
    appState.openFileInTab("/tmp/a.txt", "clean");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(true);
    expect(promptUnsavedClose).not.toHaveBeenCalled();
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.id === tabId)).toBe(false);
  });

  it("closes a dirty tab when the user discards changes", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("discard");

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(true);
    expect(saveDocumentForClose).not.toHaveBeenCalled();
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.id === tabId)).toBe(false);
  });

  it("cancels close when the user cancels the prompt", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.id === tabId)).toBe(true);
  });

  it("saves and closes when the user chooses save and save succeeds", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("save");
    vi.mocked(saveDocumentForClose).mockResolvedValue(true);

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(true);
    expect(saveDocumentForClose).toHaveBeenCalled();
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.id === tabId)).toBe(false);
  });

  it("aborts when the user chooses save but save fails", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("save");
    vi.mocked(saveDocumentForClose).mockResolvedValue(false);

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.id === tabId)).toBe(true);
  });

  it("returns false for an unknown tab id", async () => {
    await expect(closeTabWithUnsavedPrompt("missing", deps)).resolves.toBe(false);
  });
});

describe("closeOtherTabsWithUnsavedPrompt", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(promptUnsavedClose).mockReset();
    vi.mocked(saveDocumentForClose).mockReset();
  });

  it("closes other unpinned tabs and keeps the context tab selected", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");
    applyPinnedTabs();

    const closed = await closeOtherTabsWithUnsavedPrompt("tab-2", deps);

    expect(closed).toBe(true);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(["tab-2", "tab-3"]);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("aborts when a dirty tab in the close set is cancelled", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    const contextTabId = getSessionTabs(appState.getActiveSession()).find((tab) => tab.kind === "file" && tab.documentId === "doc-3")?.id;
    const dirtyDocId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(dirtyDocId!, "dirty");
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");
    const before = getSessionTabs(appState.getActiveSession()).map((tab) => tab.id);

    const closed = await closeOtherTabsWithUnsavedPrompt(contextTabId!, deps);

    expect(closed).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(before);
  });

  it("closes other tabs in an explicitly targeted inactive pane", async () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const activePaneId = layout.panes[0]!.id;
    const inactivePaneId = layout.panes[1]!.id;
    appState.openFileInPane("/tmp/inactive-a.txt", "a", inactivePaneId);
    appState.openFileInPane("/tmp/inactive-b.txt", "b", inactivePaneId);
    appState.setActiveEditorPane(activePaneId);
    const paneTabs = appState.getActiveSession().editorLayout.panes[1]!.tabs;
    const contextTabId = paneTabs[1]!.id;

    const closed = await closeOtherTabsWithUnsavedPrompt(contextTabId, deps, paneTabs);

    expect(closed).toBe(true);
    expect(appState.getActiveSession().editorLayout.panes[1]!.tabs.map((tab) => tab.id)).toEqual([
      contextTabId,
    ]);
    expect(appState.getActiveSession().editorLayout.panes[0]!.tabs).toHaveLength(1);
  });
});

describe("closeTabsToLeftWithUnsavedPrompt", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(promptUnsavedClose).mockReset();
    vi.mocked(saveDocumentForClose).mockReset();
  });

  it("closes only unpinned tabs to the left of the context tab", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");
    applyPinnedTabs();

    const closed = await closeTabsToLeftWithUnsavedPrompt("tab-3", deps);

    expect(closed).toBe(true);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual([
      "tab-3",
      "tab-4",
    ]);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-3");
  });

  it("aborts when a dirty left-side tab is cancelled", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");
    const contextTabId = getSessionTabs(appState.getActiveSession()).find((tab) => tab.kind === "file" && tab.documentId === "doc-3")?.id;
    const dirtyDocId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(dirtyDocId!, "dirty");
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");
    const before = getSessionTabs(appState.getActiveSession()).map((tab) => tab.id);

    const closed = await closeTabsToLeftWithUnsavedPrompt(contextTabId!, deps);

    expect(closed).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(before);
  });

  it("closes tabs to the left in an explicitly targeted inactive pane", async () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const activePaneId = layout.panes[0]!.id;
    const inactivePaneId = layout.panes[1]!.id;
    appState.openFileInPane("/tmp/left-a.txt", "a", inactivePaneId);
    appState.openFileInPane("/tmp/left-b.txt", "b", inactivePaneId);
    appState.openFileInPane("/tmp/left-c.txt", "c", inactivePaneId);
    appState.setActiveEditorPane(activePaneId);
    const paneTabs = appState.getActiveSession().editorLayout.panes[1]!.tabs;
    const contextTabId = paneTabs[2]!.id;
    const expectedRemainingIds = paneTabs.slice(2).map((tab) => tab.id);

    await closeTabsToLeftWithUnsavedPrompt(contextTabId, deps, paneTabs);

    expect(appState.getActiveSession().editorLayout.panes[1]!.tabs.map((tab) => tab.id)).toEqual(
      expectedRemainingIds,
    );
  });
});

describe("closeTabsToRightWithUnsavedPrompt", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(promptUnsavedClose).mockReset();
    vi.mocked(saveDocumentForClose).mockReset();
  });

  it("closes only unpinned tabs to the right of the context tab", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");
    applyPinnedTabs();

    const closed = await closeTabsToRightWithUnsavedPrompt("tab-2", deps);

    expect(closed).toBe(true);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual([
      "tab-1",
      "tab-2",
      "tab-3",
    ]);
    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("aborts when a dirty right-side tab is cancelled", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");
    const contextTabId = getSessionTabs(appState.getActiveSession()).find((tab) => tab.kind === "file" && tab.documentId === "doc-3")?.id;
    const dirtyDocId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/d.txt")?.id;
    appState.setDocumentContent(dirtyDocId!, "dirty");
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");
    const before = getSessionTabs(appState.getActiveSession()).map((tab) => tab.id);

    const closed = await closeTabsToRightWithUnsavedPrompt(contextTabId!, deps);

    expect(closed).toBe(false);
    expect(getSessionTabs(appState.getActiveSession()).map((tab) => tab.id)).toEqual(before);
  });

  it("closes tabs to the right in an explicitly targeted inactive pane", async () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const activePaneId = layout.panes[0]!.id;
    const inactivePaneId = layout.panes[1]!.id;
    appState.openFileInPane("/tmp/right-a.txt", "a", inactivePaneId);
    appState.openFileInPane("/tmp/right-b.txt", "b", inactivePaneId);
    appState.openFileInPane("/tmp/right-c.txt", "c", inactivePaneId);
    appState.setActiveEditorPane(activePaneId);
    const paneTabs = appState.getActiveSession().editorLayout.panes[1]!.tabs;
    const contextTabId = paneTabs[0]!.id;

    await closeTabsToRightWithUnsavedPrompt(contextTabId, deps, paneTabs);

    expect(appState.getActiveSession().editorLayout.panes[1]!.tabs.map((tab) => tab.id)).toEqual([
      contextTabId,
    ]);
  });
});
