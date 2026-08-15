import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";

const statMock = vi.fn();
const ensureWorkspaceReadAccessMock = vi.fn();
const markWorkspaceLifecycleActiveMock = vi.fn();
const showErrorToastMock = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: (...args: unknown[]) => statMock(...args),
}));

vi.mock("./fileSystem", () => ({
  ensureWorkspaceReadAccess: (...args: unknown[]) => ensureWorkspaceReadAccessMock(...args),
}));

vi.mock("./workspaceLifecycle", () => ({
  markWorkspaceLifecycleActive: (...args: unknown[]) => markWorkspaceLifecycleActiveMock(...args),
}));

vi.mock("./toastBus", () => ({
  showErrorToast: (...args: unknown[]) => showErrorToastMock(...args),
}));

import { openDroppedPath } from "./openDroppedPath";
import type { OpenActivePathResult } from "./openActivePath";

describe("openDroppedPath", () => {
  beforeEach(() => {
    appState.resetAppState();
    statMock.mockReset();
    ensureWorkspaceReadAccessMock.mockReset();
    markWorkspaceLifecycleActiveMock.mockReset();
    showErrorToastMock.mockReset();
    ensureWorkspaceReadAccessMock.mockResolvedValue("ok");
  });

  it("opens files through the file opener, bypassing the large-file gate", async () => {
    const openFile = vi.fn(async () => {});
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: false });

    await openDroppedPath("/tmp/note.md", openFile, notify);

    expect(openFile).toHaveBeenCalledWith("/tmp/note.md", { bypassLargeFileGate: true });
    expect(notify).not.toHaveBeenCalled();
    expect(showErrorToastMock).not.toHaveBeenCalled();
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
  });

  it("raises an error toast when the opener reports a failed open", async () => {
    const openFile = vi.fn(
      async (): Promise<OpenActivePathResult> => ({
        kind: "failed",
        path: "/tmp/note.md",
        reason: "permission denied",
      }),
    );
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: false });

    await openDroppedPath("/tmp/note.md", openFile, notify);

    expect(showErrorToastMock).toHaveBeenCalledWith("Failed to open dropped file: permission denied");
  });

  it("raises an error toast when the dropped file vanished before the open", async () => {
    const openFile = vi.fn(
      async (): Promise<OpenActivePathResult> => ({ kind: "missing", path: "/tmp/note.md" }),
    );
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: false });

    await openDroppedPath("/tmp/note.md", openFile, notify);

    expect(showErrorToastMock).toHaveBeenCalledWith("Dropped file no longer exists: /tmp/note.md");
  });

  it("notifies and toasts when stat itself fails", async () => {
    const openFile = vi.fn(async () => {});
    const notify = vi.fn();
    statMock.mockRejectedValue(new Error("forbidden path"));

    await openDroppedPath("/tmp/locked.md", openFile, notify);

    expect(openFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Failed to open dropped path: forbidden path");
    expect(showErrorToastMock).toHaveBeenCalledWith("Failed to open dropped path: forbidden path");
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

  it("toasts when a dropped workspace is inaccessible", async () => {
    const openFile = vi.fn(async () => {});
    const notify = vi.fn();
    statMock.mockResolvedValue({ isDirectory: true });
    ensureWorkspaceReadAccessMock.mockResolvedValue("blocked");

    await openDroppedPath("/tmp/secret-project", openFile, notify);

    expect(notify).toHaveBeenCalledWith("Workspace path is inaccessible. Check permissions and try again.");
    expect(showErrorToastMock).toHaveBeenCalledWith(
      "Dropped workspace is inaccessible. Check permissions and try again.",
    );
    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
  });
});
