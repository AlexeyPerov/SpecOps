import { beforeEach, describe, expect, it, vi } from "vitest";
import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { appState } from "../state/appState";
import { WINDOW_EVENT_SELECT_TAB_FOR_PATH } from "./windowManager";
import {
  completeOpenPath,
  requestOpenPath,
  selectTabForNormalizedPath,
} from "./openFileGate";
import { claimOpenFile, readOpenFileRegistry } from "./openFileRegistry";
import { initializeDocumentDiskState } from "./externalFileChanges";

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: vi.fn(),
  },
}));

vi.mock("./openFileRegistry", () => ({
  readOpenFileRegistry: vi.fn(),
  claimOpenFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./externalFileChanges", () => ({
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn(),
  };
});

const readOpenFileRegistryMock = vi.mocked(readOpenFileRegistry);
const claimOpenFileMock = vi.mocked(claimOpenFile);
const initializeDocumentDiskStateMock = vi.mocked(initializeDocumentDiskState);
const emitToMock = vi.mocked(emitTo);
const getByLabelMock = vi.mocked(WebviewWindow.getByLabel);

describe("requestOpenPath", () => {
  beforeEach(() => {
    appState.resetAppState();
    readOpenFileRegistryMock.mockReset();
    claimOpenFileMock.mockClear();
    emitToMock.mockClear();
    getByLabelMock.mockReset();
  });

  it("redirects to the owning window for cross-window paths", async () => {
    readOpenFileRegistryMock.mockResolvedValue({
      "/tmp/shared.txt": { windowId: "win-b", documentId: "doc-9" },
    });
    const focus = vi.fn().mockResolvedValue(undefined);
    getByLabelMock.mockResolvedValue({ setFocus: focus } as never);

    await expect(requestOpenPath("/tmp/shared.txt", "win-a")).resolves.toEqual({
      kind: "redirected",
      path: "/tmp/shared.txt",
      ownerWindowId: "win-b",
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(emitToMock).toHaveBeenCalledWith("win-b", WINDOW_EVENT_SELECT_TAB_FOR_PATH, {
      path: "/tmp/shared.txt",
    });
  });

  it("reuses an existing document in the same window", async () => {
    readOpenFileRegistryMock.mockResolvedValue({});
    appState.openFileInTab("/tmp/existing.txt", "hello");

    await expect(requestOpenPath("/tmp/existing.txt", "win-a")).resolves.toEqual({
      kind: "existing",
      path: "/tmp/existing.txt",
      documentId: "doc-2",
    });
    expect(claimOpenFileMock).toHaveBeenCalledWith("/tmp/existing.txt", "win-a", "doc-2");
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-2");
  });

  it("returns needs_read for a new path", async () => {
    readOpenFileRegistryMock.mockResolvedValue({});
    await expect(requestOpenPath("/tmp/new.txt", "win-a")).resolves.toEqual({
      kind: "needs_read",
      path: "/tmp/new.txt",
    });
  });
});

describe("selectTabForNormalizedPath", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("selects the tab for a normalized path", () => {
    appState.openFileInTab("/tmp/select.txt", "content");
    expect(selectTabForNormalizedPath("/tmp/select.txt")).toBe(true);
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-2");
  });

  it("returns false when no tab matches", () => {
    expect(selectTabForNormalizedPath("/tmp/missing.txt")).toBe(false);
  });
});

describe("completeOpenPath", () => {
  beforeEach(() => {
    appState.resetAppState();
    claimOpenFileMock.mockClear();
    initializeDocumentDiskStateMock.mockClear();
  });

  it("opens the file, claims registry ownership, and initializes disk state", async () => {
    await expect(completeOpenPath("/tmp/complete.txt", "payload", "win-a")).resolves.toBe("doc-2");
    expect(claimOpenFileMock).toHaveBeenCalledWith("/tmp/complete.txt", "win-a", "doc-2");
    expect(initializeDocumentDiskStateMock).toHaveBeenCalledWith("doc-2", "/tmp/complete.txt");
    expect(appState.getSnapshot().documents.find((doc) => doc.id === "doc-2")?.content).toBe(
      "payload",
    );
  });
});
