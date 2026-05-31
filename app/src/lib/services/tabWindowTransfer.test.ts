import { beforeEach, describe, expect, it, vi } from "vitest";
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
    const tabId = appState.getSnapshot().session.selectedTabId!;
    createNewWindowWithTransferMock.mockResolvedValue(null);
    const notify = vi.fn();

    await expect(
      moveTabToNewWindow({ tabId, sourceWindowId: "main", notify }),
    ).resolves.toBe(false);

    expect(appState.getSnapshot().session.openTabs).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith("Failed to open new window.");
    expect(syncOpenFileRegistryForWindowMock).not.toHaveBeenCalled();
  });

  it("removes the tab and syncs registry after successful transfer", async () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const tabId = appState.getSnapshot().session.selectedTabId!;
    createNewWindowWithTransferMock.mockResolvedValue("window-2");
    const notify = vi.fn();

    await expect(
      moveTabToNewWindow({ tabId, sourceWindowId: "main", notify }),
    ).resolves.toBe(true);

    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);
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
});
