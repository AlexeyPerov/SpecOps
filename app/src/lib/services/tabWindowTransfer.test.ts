import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitTo, listen } from "@tauri-apps/api/event";
import { allTabs, getSessionSelectedTabId, getSessionTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  MERGE_TAB_ACK_TIMEOUT_MS,
  moveTabToExistingWindow,
  moveTabToNewWindow,
  requestMergeTabAck,
} from "./tabWindowTransfer";
import { createNewWindowWithTransfer, WINDOW_EVENT_MERGE_TAB, WINDOW_EVENT_MERGE_TAB_ACK } from "./windowManager";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock("./windowManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./windowManager")>();
  return {
    ...actual,
    createNewWindowWithTransfer: vi.fn(),
  };
});

vi.mock("./openFileRegistry", () => ({
  syncOpenFileRegistryForWindow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./emptyWindowLifecycle", () => ({
  closeCurrentWindowIfEmptyAfterTransfer: vi.fn().mockResolvedValue(false),
}));

vi.mock("./windowTargeting", () => ({
  findWebviewWindowAtScreenPoint: vi.fn(),
  focusWebviewWindow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./closeTabFlow", () => ({
  confirmDirtyTabBeforeTransfer: vi.fn().mockResolvedValue(true),
}));

const createNewWindowWithTransferMock = vi.mocked(createNewWindowWithTransfer);
const syncOpenFileRegistryForWindowMock = vi.mocked(syncOpenFileRegistryForWindow);
const emitToMock = vi.mocked(emitTo);
const listenMock = vi.mocked(listen);

describe("moveTabToNewWindow", () => {
  beforeEach(() => {
    appState.resetAppState();
    createNewWindowWithTransferMock.mockReset();
    syncOpenFileRegistryForWindowMock.mockClear();
    emitToMock.mockClear();
    listenMock.mockReset();
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

describe("moveTabToExistingWindow", () => {
  beforeEach(() => {
    appState.resetAppState();
    syncOpenFileRegistryForWindowMock.mockClear();
    emitToMock.mockReset();
    emitToMock.mockResolvedValue(undefined);
    listenMock.mockReset();
  });

  function mockAck(sourceTabId: string, ok: boolean, error?: string): void {
    listenMock.mockImplementation(async (eventName, handler) => {
      expect(eventName).toBe(WINDOW_EVENT_MERGE_TAB_ACK);
      emitToMock.mockImplementation(async () => {
        handler({
          event: WINDOW_EVENT_MERGE_TAB_ACK,
          id: 1,
          payload: {
            sourceTabId,
            ok,
            error,
          },
        } as never);
      });
      return () => {};
    });
  }

  it("keeps the source tab when the target reports failure", async () => {
    appState.openFileInTab("/tmp/keep-me.txt", "payload");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    const tabCountBefore = getSessionTabs(appState.getActiveSession()).length;
    mockAck(tabId, false, "Target rejected the tab.");
    const notify = vi.fn();

    await expect(
      moveTabToExistingWindow({
        tabId,
        sourceWindowId: "main",
        targetWindowId: "window-2",
        notify,
      }),
    ).resolves.toBe(false);

    expect(getSessionTabs(appState.getActiveSession())).toHaveLength(tabCountBefore);
    expect(allTabs(appState.getActiveSession().editorLayout).some((entry) => entry.id === tabId)).toBe(
      true,
    );
    expect(notify).toHaveBeenCalledWith("Target rejected the tab.");
    expect(syncOpenFileRegistryForWindowMock).not.toHaveBeenCalled();
    expect(emitToMock).toHaveBeenCalledWith(
      "window-2",
      WINDOW_EVENT_MERGE_TAB,
      expect.objectContaining({ sourceTabId: tabId, sourceWindowId: "main" }),
    );
  });

  it("removes the source tab and syncs registry once after successful ack", async () => {
    appState.openFileInTab("/tmp/move-ack.txt", "payload");
    const tabId = getSessionSelectedTabId(appState.getActiveSession())!;
    mockAck(tabId, true);
    const notify = vi.fn();

    await expect(
      moveTabToExistingWindow({
        tabId,
        sourceWindowId: "main",
        targetWindowId: "window-2",
        notify,
      }),
    ).resolves.toBe(true);

    expect(allTabs(appState.getActiveSession().editorLayout).some((entry) => entry.id === tabId)).toBe(
      false,
    );
    expect(syncOpenFileRegistryForWindowMock).toHaveBeenCalledTimes(1);
    expect(syncOpenFileRegistryForWindowMock).toHaveBeenCalledWith(
      "main",
      appState.getSnapshot(),
    );
  });
});

describe("requestMergeTabAck", () => {
  beforeEach(() => {
    emitToMock.mockReset();
    emitToMock.mockResolvedValue(undefined);
    listenMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out and reports failure when no ack arrives", async () => {
    listenMock.mockResolvedValue(vi.fn());
    const ackPromise = requestMergeTabAck("window-2", {
      filePath: "/tmp/x.txt",
      content: "x",
      title: "x.txt",
      sourceWindowId: "main",
      sourceTabId: "tab-1",
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(MERGE_TAB_ACK_TIMEOUT_MS);
    await expect(ackPromise).resolves.toEqual({
      sourceTabId: "tab-1",
      ok: false,
      error: expect.stringContaining("Timed out"),
    });
  });
});
