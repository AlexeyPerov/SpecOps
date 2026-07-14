import { beforeEach, describe, expect, it, vi } from "vitest";
import { allTabs, getSessionSelectedTabId, getSessionTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import { moveTabToNewWindow } from "./tabWindowTransfer";
import { createNewWindowWithTransfer } from "./windowManager";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";

vi.mock("./windowManager", () => ({
  createNewWindowWithTransfer: vi.fn(),
}));

vi.mock("./openFileRegistry", () => ({
  syncOpenFileRegistryForWindow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./emptyWindowLifecycle", () => ({
  closeCurrentWindowIfEmptyAfterTransfer: vi.fn().mockResolvedValue(false),
}));

const createNewWindowWithTransferMock = vi.mocked(createNewWindowWithTransfer);
const syncOpenFileRegistryForWindowMock = vi.mocked(syncOpenFileRegistryForWindow);

describe("moveTabToNewWindow", () => {
  beforeEach(() => {
    appState.resetAppState();
    createNewWindowWithTransferMock.mockReset();
    syncOpenFileRegistryForWindowMock.mockClear();
  });

  it("keeps the tab when window creation fails", async () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    createNewWindowWithTransferMock.mockResolvedValue(null);
    const notify = vi.fn();

    await expect(
      moveTabToNewWindow({ tabId, sourceWindowId: "main", notify }),
    ).resolves.toBe(false);

    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith("Failed to open new window.");
    expect(syncOpenFileRegistryForWindowMock).not.toHaveBeenCalled();
  });

  it("removes the tab and syncs registry after successful transfer", async () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    createNewWindowWithTransferMock.mockResolvedValue("window-2");
    const notify = vi.fn();

    await expect(
      moveTabToNewWindow({ tabId, sourceWindowId: "main", notify }),
    ).resolves.toBe(true);

    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(1);
    expect(createNewWindowWithTransferMock).toHaveBeenCalledWith(expect.anything(), {
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
    expect(syncOpenFileRegistryForWindowMock).toHaveBeenCalledWith(
      "main",
      appState.getSnapshot(),
    );
  });

  it("transfers a tab owned by an inactive pane", async () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const activePaneId = layout.panes[0]!.id;
    const inactivePaneId = layout.panes[1]!.id;
    const documentId = appState.openFileInPane(
      "/tmp/inactive-pane-transfer.txt",
      "payload",
      inactivePaneId,
    );
    appState.setActiveEditorPane(activePaneId);
    const tab = allTabs(appState.getActiveSession().editorLayout).find(
      (entry) => isFileTab(entry) && entry.documentId === documentId,
    );
    createNewWindowWithTransferMock.mockResolvedValue("window-2");

    await expect(
      moveTabToNewWindow({
        tabId: tab!.id,
        sourceWindowId: "main",
        notify: vi.fn(),
      }),
    ).resolves.toBe(true);

    expect(
      allTabs(appState.getActiveSession().editorLayout).some((entry) => entry.id === tab!.id),
    ).toBe(false);
    expect(createNewWindowWithTransferMock).toHaveBeenCalledWith(expect.anything(), {
      filePath: "/tmp/inactive-pane-transfer.txt",
      content: "payload",
      title: "inactive-pane-transfer.txt",
    });
  });
});
