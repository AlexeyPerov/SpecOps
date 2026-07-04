import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { autosaveWorkspaceDirtyDocuments } from "./preGitAutosave";
import { saveDocumentKeepingTab } from "./documentSave";

vi.mock("./documentSave", () => ({
  saveDocumentKeepingTab: vi.fn(),
}));

const saveDocumentKeepingTabMock = vi.mocked(saveDocumentKeepingTab);

describe("autosaveWorkspaceDirtyDocuments", () => {
  beforeEach(() => {
    appState.resetAppState();
    saveDocumentKeepingTabMock.mockReset();
  });

  it("returns empty result when there are no dirty documents", async () => {
    appState.addWorkspace("/tmp/ws");
    const workspaceId = appState.getSnapshot().contexts.activeContextId;

    await expect(
      autosaveWorkspaceDirtyDocuments(workspaceId, {
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toEqual({
      savedCount: 0,
      skipped: [],
      failures: [],
    });

    expect(saveDocumentKeepingTabMock).not.toHaveBeenCalled();
  });

  it("saves dirty documents in deterministic path order", async () => {
    appState.addWorkspace("/tmp/ws");
    const workspaceId = appState.getSnapshot().contexts.activeContextId;
    appState.openFileInTab("/tmp/ws/z-last.txt", "z");
    appState.openFileInTab("/tmp/ws/a-first.txt", "a");
    const docs = appState.getActiveDocuments();
    appState.setDocumentContent(
      docs.find((doc) => doc.filePath?.endsWith("z-last.txt"))!.id,
      "z dirty",
    );
    appState.setDocumentContent(
      docs.find((doc) => doc.filePath?.endsWith("a-first.txt"))!.id,
      "a dirty",
    );

    saveDocumentKeepingTabMock.mockResolvedValue(true);

    const result = await autosaveWorkspaceDirtyDocuments(workspaceId, {
      deps: { getWindowId: () => "win-a", notify: vi.fn() },
    });

    expect(result.savedCount).toBe(2);
    expect(result.failures).toEqual([]);
    expect(saveDocumentKeepingTabMock.mock.calls.map(([doc]) => doc.filePath)).toEqual([
      "/tmp/ws/a-first.txt",
      "/tmp/ws/z-last.txt",
    ]);
  });

  it("reports partial failures without throwing", async () => {
    appState.addWorkspace("/tmp/ws");
    const workspaceId = appState.getSnapshot().contexts.activeContextId;
    appState.openFileInTab("/tmp/ws/one.txt", "one");
    appState.openFileInTab("/tmp/ws/two.txt", "two");
    const docs = appState.getActiveDocuments();
    appState.setDocumentContent(docs[0]!.id, "one dirty");
    appState.setDocumentContent(docs[1]!.id, "two dirty");

    saveDocumentKeepingTabMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const result = await autosaveWorkspaceDirtyDocuments(workspaceId, {
      deps: { getWindowId: () => "win-a", notify: vi.fn() },
    });

    expect(result.savedCount).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.title).toBeTruthy();
  });

  it("reports save exceptions as failures", async () => {
    appState.addWorkspace("/tmp/ws");
    const workspaceId = appState.getSnapshot().contexts.activeContextId;
    appState.openFileInTab("/tmp/ws/fail.txt", "fail");
    appState.setDocumentContent(appState.getActiveDocuments()[0]!.id, "dirty");

    saveDocumentKeepingTabMock.mockRejectedValue(new Error("disk full"));

    const result = await autosaveWorkspaceDirtyDocuments(workspaceId, {
      deps: { getWindowId: () => "win-a", notify: vi.fn() },
    });

    expect(result.savedCount).toBe(0);
    expect(result.failures).toEqual([
      expect.objectContaining({
        message: "disk full",
      }),
    ]);
  });

  it("no-ops when disabled via options", async () => {
    appState.addWorkspace("/tmp/ws");
    const workspaceId = appState.getSnapshot().contexts.activeContextId;
    appState.openFileInTab("/tmp/ws/doc.txt", "content");
    appState.setDocumentContent(appState.getActiveDocuments()[0]!.id, "dirty");

    await expect(
      autosaveWorkspaceDirtyDocuments(workspaceId, {
        enabled: false,
        deps: { getWindowId: () => "win-a", notify: vi.fn() },
      }),
    ).resolves.toEqual({
      savedCount: 0,
      skipped: [],
      failures: [],
    });

    expect(saveDocumentKeepingTabMock).not.toHaveBeenCalled();
  });
});
