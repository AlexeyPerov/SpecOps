import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  clearFileWatcherPaths,
  FILE_CHANGED_EVENT,
  syncFileWatcherPaths,
  syncProjectTreeWatcher,
} from "./fileWatcher";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

const invokeMock = vi.mocked(invoke);

describe("fileWatcher", () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it("keeps FILE_CHANGED_EVENT constant value", () => {
    expect(FILE_CHANGED_EVENT).toBe("spec-ops/fs/file-changed");
  });

  it("syncFileWatcherPaths invokes sync_file_watcher_paths with paths", async () => {
    const paths = ["/a", "/b"];

    await syncFileWatcherPaths(paths);

    expect(invokeMock).toHaveBeenCalledWith("sync_file_watcher_paths", { paths });
  });

  it("clearFileWatcherPaths invokes sync_file_watcher_paths with empty paths", async () => {
    await clearFileWatcherPaths();

    expect(invokeMock).toHaveBeenCalledWith("sync_file_watcher_paths", { paths: [] });
  });

  it("syncProjectTreeWatcher invokes sync_project_tree_watcher", async () => {
    await syncProjectTreeWatcher("/tmp/ws");

    expect(invokeMock).toHaveBeenCalledWith("sync_project_tree_watcher", { root: "/tmp/ws" });
  });
});
