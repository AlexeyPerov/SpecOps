import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { getSessionTabs, isFileTab } from "../domain/contracts";
import { saveDocumentForClose } from "./documentSave";
import { saveFile, saveFileAs } from "./fileSystem";
import { claimOpenFile, renameOpenFileRegistry } from "./openFileRegistry";

vi.mock("./fileSystem", () => ({
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
}));

vi.mock("./openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn().mockResolvedValue(undefined),
  claimOpenFile: vi.fn().mockResolvedValue(undefined),
}));

const saveFileMock = vi.mocked(saveFile);
const saveFileAsMock = vi.mocked(saveFileAs);
const renameOpenFileRegistryMock = vi.mocked(renameOpenFileRegistry);
const claimOpenFileMock = vi.mocked(claimOpenFile);

describe("saveDocumentForClose", () => {
  beforeEach(() => {
    appState.resetAppState();
    saveFileMock.mockReset();
    saveFileAsMock.mockReset();
    renameOpenFileRegistryMock.mockClear();
    claimOpenFileMock.mockClear();
  });

  it("does not move the tab to Notepad when saving outside the workspace root and unrestricted", async () => {
    appState.addWorkspace("/tmp/ws");
    appState.openFileInTab("/tmp/ws/doc.txt", "content");
    const document = appState.getActiveDocuments()[0]!;
    saveFileMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 7 });

    await expect(
      saveDocumentForClose(
        { ...document, filePath: "/tmp/outside.txt" },
        { getWindowId: () => "win-a", notify: vi.fn() },
      ),
    ).resolves.toBe(true);

    expect(appState.getSnapshot().contexts.activeContextId).toBe("ws-1");
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.kind === "file")).toBe(
      true,
    );
  });

  it("moves the tab to Notepad when saving outside the workspace root and restricted", async () => {
    appState.addWorkspace("/tmp/ws");
    appState.setRestrictFilesToContext(true);
    appState.openFileInTab("/tmp/ws/doc.txt", "content");
    const document = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/ws/doc.txt")!;
    saveFileMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 7 });

    await expect(
      saveDocumentForClose(
        { ...document, filePath: "/tmp/outside.txt", title: "outside.txt" },
        { getWindowId: () => "win-a", notify: vi.fn() },
      ),
    ).resolves.toBe(true);

    expect(appState.isNotepadActive()).toBe(true);
    const notepadDoc = appState
      .getSnapshot()
      .contexts.notepad.documents.find((doc) => doc.filePath === "/tmp/outside.txt");
    expect(notepadDoc).toBeDefined();
    expect(notepadDoc).toMatchObject({
      content: "content",
      savedContent: "content",
      isDirty: false,
      diskFingerprint: { mtimeMs: 1, sizeBytes: 7 },
      fileMissing: false,
    });
    expect(appState.getSnapshot().contexts.workspaces[0]?.snapshot.documents).not.toContainEqual(
      expect.objectContaining({ filePath: "/tmp/outside.txt" }),
    );
    const notepadTab = getSessionTabs(appState.getSnapshot().contexts.notepad.session).find(
      (tab) => isFileTab(tab) && tab.documentId === notepadDoc?.id,
    );
    expect(notepadTab).toBeDefined();
    expect(renameOpenFileRegistryMock).toHaveBeenCalledWith(
      "/tmp/outside.txt",
      "/tmp/outside.txt",
      "win-a",
      notepadDoc?.id,
    );
    expect(claimOpenFileMock).toHaveBeenCalledWith("/tmp/outside.txt", "win-a", notepadDoc?.id);
  });
});
