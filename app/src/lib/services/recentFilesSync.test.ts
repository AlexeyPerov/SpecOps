import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./sessionManager", () => ({
  persistGlobalRecentFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("./recentFilesSync", async (importOriginal) => importOriginal());

import { appState } from "../state/appState";
import {
  commitRecentFiles,
  resetRecentFilesSyncForTests,
  runWithRecentFilesBatch,
  syncRecentFiles,
} from "./recentFilesSync";
import { emit } from "@tauri-apps/api/event";
import { persistGlobalRecentFiles } from "./sessionManager";

const emitMock = vi.mocked(emit);
const persistMock = vi.mocked(persistGlobalRecentFiles);

describe("recentFilesSync batching", () => {
  beforeEach(() => {
    resetRecentFilesSyncForTests();
    appState.resetWorkspace();
    emitMock.mockClear();
    persistMock.mockClear();
  });

  it("commits immediately outside a batch", async () => {
    syncRecentFiles(["/tmp/a.txt"]);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("defers commit until the batch completes", async () => {
    await runWithRecentFilesBatch(async () => {
      syncRecentFiles(["/tmp/a.txt"]);
      syncRecentFiles(["/tmp/b.txt", "/tmp/a.txt"]);
      expect(persistMock).not.toHaveBeenCalled();
      expect(emitMock).not.toHaveBeenCalled();
    });

    expect(persistMock).toHaveBeenCalledTimes(1);
    expect(persistMock).toHaveBeenCalledWith(["/tmp/b.txt", "/tmp/a.txt"]);
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it("still commits directly through commitRecentFiles", async () => {
    await commitRecentFiles(["/tmp/direct.txt"]);
    expect(persistMock).toHaveBeenCalledWith(["/tmp/direct.txt"]);
  });
});
