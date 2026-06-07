import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  closeOtherTabsWithUnsavedPrompt,
  closeTabWithUnsavedPrompt,
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
        openTabs: [
          createFileTab("tab-1", "doc-1"),
          createFileTab("tab-2", "doc-2"),
          createFileTab("tab-3", "doc-3", true),
          createFileTab("tab-4", "doc-4"),
        ],
        selectedTabId: "tab-4",
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
    const tabId = appState.getActiveSession().selectedTabId!;

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(true);
    expect(promptUnsavedClose).not.toHaveBeenCalled();
    expect(appState.getActiveSession().openTabs.some((tab) => tab.id === tabId)).toBe(false);
  });

  it("closes a dirty tab when the user discards changes", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = appState.getActiveSession().selectedTabId!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("discard");

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(true);
    expect(saveDocumentForClose).not.toHaveBeenCalled();
    expect(appState.getActiveSession().openTabs.some((tab) => tab.id === tabId)).toBe(false);
  });

  it("cancels close when the user cancels the prompt", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = appState.getActiveSession().selectedTabId!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(false);
    expect(appState.getActiveSession().openTabs.some((tab) => tab.id === tabId)).toBe(true);
  });

  it("saves and closes when the user chooses save and save succeeds", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = appState.getActiveSession().selectedTabId!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("save");
    vi.mocked(saveDocumentForClose).mockResolvedValue(true);

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(true);
    expect(saveDocumentForClose).toHaveBeenCalled();
    expect(appState.getActiveSession().openTabs.some((tab) => tab.id === tabId)).toBe(false);
  });

  it("aborts when the user chooses save but save fails", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(documentId!, "dirty");
    const tabId = appState.getActiveSession().selectedTabId!;
    vi.mocked(promptUnsavedClose).mockResolvedValue("save");
    vi.mocked(saveDocumentForClose).mockResolvedValue(false);

    const closed = await closeTabWithUnsavedPrompt(tabId, deps);

    expect(closed).toBe(false);
    expect(appState.getActiveSession().openTabs.some((tab) => tab.id === tabId)).toBe(true);
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
    expect(appState.getActiveSession().openTabs.map((tab) => tab.id)).toEqual(["tab-2", "tab-3"]);
    expect(appState.getActiveSession().selectedTabId).toBe("tab-2");
  });

  it("aborts when a dirty tab in the close set is cancelled", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    const contextTabId = appState
      .getActiveSession()
      .openTabs.find((tab) => tab.kind === "file" && tab.documentId === "doc-3")?.id;
    const dirtyDocId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")?.id;
    appState.setDocumentContent(dirtyDocId!, "dirty");
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");
    const before = appState.getActiveSession().openTabs.map((tab) => tab.id);

    const closed = await closeOtherTabsWithUnsavedPrompt(contextTabId!, deps);

    expect(closed).toBe(false);
    expect(appState.getActiveSession().openTabs.map((tab) => tab.id)).toEqual(before);
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
    expect(appState.getActiveSession().openTabs.map((tab) => tab.id)).toEqual([
      "tab-1",
      "tab-2",
      "tab-3",
    ]);
    expect(appState.getActiveSession().selectedTabId).toBe("tab-2");
  });

  it("aborts when a dirty right-side tab is cancelled", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");
    const contextTabId = appState
      .getActiveSession()
      .openTabs.find((tab) => tab.kind === "file" && tab.documentId === "doc-3")?.id;
    const dirtyDocId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/d.txt")?.id;
    appState.setDocumentContent(dirtyDocId!, "dirty");
    vi.mocked(promptUnsavedClose).mockResolvedValue("cancel");
    const before = appState.getActiveSession().openTabs.map((tab) => tab.id);

    const closed = await closeTabsToRightWithUnsavedPrompt(contextTabId!, deps);

    expect(closed).toBe(false);
    expect(appState.getActiveSession().openTabs.map((tab) => tab.id)).toEqual(before);
  });
});
