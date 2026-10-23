import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./confirmDialogUi", () => ({ requestConfirm: vi.fn() }));
vi.mock("./openFileRegistry", () => ({ syncOpenFileRegistryForWindow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./workspaceCloseFlow", () => ({ saveAllDirtyDocumentsToDisk: vi.fn() }));
import { appState } from "../state/appState";
import type { ContextId } from "../domain/contracts";
import { requestConfirm } from "./confirmDialogUi";
import { syncOpenFileRegistryForWindow } from "./openFileRegistry";
import { saveAllDirtyDocumentsToDisk } from "./workspaceCloseFlow";
import { removeTabGroupWithConfirm } from "./tabGroupCloseFlow";

const confirm = vi.mocked(requestConfirm);
const saveAll = vi.mocked(saveAllDirtyDocumentsToDisk);
const deps = { getWindowId: () => "main" };

function dirtyGroup(): ContextId {
  const id = appState.createTabGroup("Drafts");
  appState.setDocumentContent(appState.getActiveDocuments()[0].id, "unsaved");
  return id;
}

describe("removeTabGroupWithConfirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.resetAppState();
  });

  it("refuses the default group", async () => {
    const notify = vi.fn();
    await expect(removeTabGroupWithConfirm("tabs-default", notify, deps)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith("The default tab group cannot be deleted.");
    expect(appState.getSnapshot().contexts.tabGroups).toHaveLength(1);
  });

  it("deletes a clean group without prompting and releases its file claims", async () => {
    const id = appState.createTabGroup("Drafts");
    await expect(removeTabGroupWithConfirm(id, vi.fn(), deps)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(appState.getSnapshot().contexts.tabGroups.map((group) => group.id)).toEqual(["tabs-default"]);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("tabs-default");
    expect(syncOpenFileRegistryForWindow).toHaveBeenCalledWith("main", appState.getSnapshot());
  });

  it("saves dirty buffers before deleting", async () => {
    const id = dirtyGroup();
    confirm.mockResolvedValueOnce(true);
    saveAll.mockResolvedValueOnce(true);
    await expect(removeTabGroupWithConfirm(id, vi.fn(), deps)).resolves.toBe(true);
    expect(saveAll).toHaveBeenCalledWith(id, expect.arrayContaining([expect.objectContaining({ content: "unsaved" })]), expect.any(Function), deps);
  });

  it("keeps the group when saving fails or discarding is cancelled", async () => {
    const id = dirtyGroup();
    confirm.mockResolvedValueOnce(true);
    saveAll.mockResolvedValueOnce(false);
    await expect(removeTabGroupWithConfirm(id, vi.fn(), deps)).resolves.toBe(false);
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(removeTabGroupWithConfirm(id, vi.fn(), deps)).resolves.toBe(false);
    expect(appState.getSnapshot().contexts.tabGroups.some((group) => group.id === id)).toBe(true);
  });

  it("discards dirty buffers after a second confirmation", async () => {
    const id = dirtyGroup();
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(removeTabGroupWithConfirm(id, vi.fn(), deps)).resolves.toBe(true);
    expect(saveAll).not.toHaveBeenCalled();
    expect(appState.getSnapshot().contexts.tabGroups.some((group) => group.id === id)).toBe(false);
  });
});
