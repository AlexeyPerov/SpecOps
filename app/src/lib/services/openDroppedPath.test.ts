import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";

const statMock = vi.fn();
const ensureWorkspaceReadAccessMock = vi.fn();
const markWorkspaceLifecycleActiveMock = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: (...args: unknown[]) => statMock(...args),
}));

vi.mock("./fileSystem", () => ({
  ensureWorkspaceReadAccess: (...args: unknown[]) => ensureWorkspaceReadAccessMock(...args),
}));

vi.mock("./workspaceLifecycle", () => ({
  markWorkspaceLifecycleActive: (...args: unknown[]) => markWorkspaceLifecycleActiveMock(...args),
}));

import { openDroppedPath } from "./openDroppedPath";

describe("openDroppedPath", () => {
  beforeEach(() => {
    appState.resetAppState();
    statMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    markWorkspaceLifecycleActiveMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ok");
  });

  it("opens files through the file opener", async () => {
    const openFile = vi.fn(async () => {});
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: false });

    await openDroppedPath("/tmp/note.md", openFile, notify);

    expect(openFile).toHaveBeenCalledWith("/tmp/note.md");
    expect(notify).not.toHaveBeenCalled();
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
  });

  it("adds directories as workspaces instead of reading them as files", async () => {
    const openFile = vi.fn(async () => {});
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: true });

    await openDroppedPath("/tmp/project", openFile, notify);

    expect(openFile).not.toHaveBeenCalled();
    expect(appState.getSnapshot().contexts.workspaces.map((ws) => ws.rootPath)).toEqual([
      "/tmp/project",
    ]);
    expect(markWorkspaceLifecycleActiveMock).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Workspace added.");
  });

  it("notifies when a dropped workspace is already open", async () => {
    appState.addWorkspace("/tmp/project");
    const openFile = vi.fn(async () => {});
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: true });

    await openDroppedPath("/tmp/project", openFile, notify);

    expect(notify).toHaveBeenCalledWith("Workspace is already open.");
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
  });
});
