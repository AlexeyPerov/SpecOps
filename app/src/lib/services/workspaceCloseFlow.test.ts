import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { registerConfirmRunner } from "./confirmDialogUi";
import { closeWorkspaceWithConfirm } from "./workspaceCloseFlow";
import { saveFile, saveFileAs } from "./fileSystem";
import { renameOpenFileRegistry } from "./openFileRegistry";

vi.mock("./fileSystem", () => ({
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
}));

vi.mock("./openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./untitledSavePath", () => ({
  untitledSaveDefaultPath: vi.fn().mockResolvedValue(undefined),
}));

const saveFileMock = vi.mocked(saveFile);
const saveFileAsMock = vi.mocked(saveFileAs);
const renameMock = vi.mocked(renameOpenFileRegistry);

function setConfirmResult(result: boolean): void {
  registerConfirmRunner(() => Promise.resolve(result));
}

describe("closeWorkspaceWithConfirm — Save all writes to disk", () => {
  beforeEach(() => {
    appState.resetAppState();
    saveFileMock.mockReset();
    saveFileAsMock.mockReset();
    renameMock.mockReset();
    registerConfirmRunner(null);
  });

  it("persists dirty saved files to disk before closing", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws/a.txt")!;
    appState.setDocumentContent(documentId, "edited");
    expect(
      appState.getActiveDocuments().find((doc) => doc.id === documentId)?.isDirty,
    ).toBe(true);

    saveFileMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 6 });
    setConfirmResult(true); // choose "Save all"

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    // Disk write happened with the buffer content (not just markDocumentSaved).
    expect(saveFileMock).toHaveBeenCalledWith({
      path: "/tmp/ws/a.txt",
      content: "edited",
    });
    expect(renameMock).toHaveBeenCalledWith("/tmp/ws/a.txt", "/tmp/ws/a.txt", "win-a", documentId);
    // Workspace removed.
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(false);
  });

  it("aborts close when an untitled save-as is dismissed", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.createTab(); // untitled doc in the active workspace
    const document = appState.getActiveDocuments().find((doc) => doc.filePath === null);
    if (!document) {
      throw new Error("expected an untitled document");
    }
    appState.setDocumentContent(document.id, "unsaved text");

    saveFileAsMock.mockResolvedValue(null); // user cancels save-as
    setConfirmResult(true); // choose "Save all"

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(false);
    expect(saveFileAsMock).toHaveBeenCalledOnce();
    // Workspace still present (close aborted).
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(true);
  });

  it("saves an untitled file via save-as and closes", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.createTab();
    const document = appState.getActiveDocuments().find((doc) => doc.filePath === null);
    if (!document) {
      throw new Error("expected an untitled document");
    }
    appState.setDocumentContent(document.id, "new content");

    saveFileAsMock.mockResolvedValue({
      path: "/tmp/ws/saved.txt",
      fingerprint: { mtimeMs: 5, sizeBytes: 10 },
    });
    setConfirmResult(true);

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    expect(saveFileAsMock).toHaveBeenCalledWith("new content", undefined);
    expect(renameMock).toHaveBeenCalledWith(null, "/tmp/ws/saved.txt", "win-a", document.id);
  });

  it("discards and closes without writing when the user chooses discard", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws/a.txt")!;
    appState.setDocumentContent(documentId, "dirty");

    // First confirm: "Save all?" -> No (More options). Second: "Discard?" -> Yes.
    const results = [false, true];
    let i = 0;
    registerConfirmRunner(() => Promise.resolve(results[i++] ?? false));

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    expect(saveFileMock).not.toHaveBeenCalled();
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(false);
  });

  it("aborts close when the user cancels both save and discard", async () => {
    const wsId = appState.addWorkspace("/tmp/ws")!;
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws/a.txt")!;
    appState.setDocumentContent(documentId, "dirty");

    const results = [false, false]; // No to save, No to discard.
    let i = 0;
    registerConfirmRunner(() => Promise.resolve(results[i++] ?? false));

    const closed = await closeWorkspaceWithConfirm(wsId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(false);
    expect(saveFileMock).not.toHaveBeenCalled();
    expect(
      appState.getSnapshot().contexts.workspaces.some((ws) => ws.id === wsId),
    ).toBe(true);
  });

  it("persists even when the workspace is not the active context", async () => {
    const wsAId = appState.addWorkspace("/tmp/ws-a")!;
    const wsBId = appState.addWorkspace("/tmp/ws-b")!;
    // Active context is now ws-b; close ws-a while it is not active.
    appState.switchContext(wsAId);
    appState.openFileInTab("/tmp/ws-a/a.txt", "old");
    const documentId = appState.findDocumentIdByPath("/tmp/ws-a/a.txt")!;
    appState.setDocumentContent(documentId, "edited-a");
    appState.switchContext(wsBId);
    expect(appState.getSnapshot().contexts.activeContextId).toBe(wsBId);

    saveFileMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 8 });
    setConfirmResult(true);

    const closed = await closeWorkspaceWithConfirm(wsAId, vi.fn(), {
      getWindowId: () => "win-a",
    });

    expect(closed).toBe(true);
    expect(saveFileMock).toHaveBeenCalledWith({
      path: "/tmp/ws-a/a.txt",
      content: "edited-a",
    });
  });
});
