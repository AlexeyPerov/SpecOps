import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fileWatcher", () => ({
  syncProjectTreeWatcher: vi.fn(async () => {}),
}));

import { syncProjectTreeWatcher } from "./fileWatcher";
import {
  resetAppShellEffectsForTests,
  syncActiveFileTreeExpandEffect,
  syncProjectTreeWatcherEffect,
  type SyncActiveFileTreeExpandEffectInput,
  type SyncProjectTreeWatcherEffectInput,
} from "./appShellEffects";

describe("syncActiveFileTreeExpandEffect", () => {
  beforeEach(() => {
    resetAppShellEffectsForTests();
    vi.useFakeTimers();
  });

  it("debounces rapid active-file changes and applies only the latest path", () => {
    const ensureExpandedForActiveFile = vi.fn(async () => {});
    const input = (
      activeDocumentPath: string | null,
    ): SyncActiveFileTreeExpandEffectInput => ({
      activeDocumentPath,
      isChatHttpActive: false,
      activeWorkspaceRoot: "/repo",
      projectTreeController: {
        ensureExpandedForActiveFile,
      } as unknown as SyncActiveFileTreeExpandEffectInput["projectTreeController"],
    });

    syncActiveFileTreeExpandEffect(input("/repo/src/one.ts"));
    syncActiveFileTreeExpandEffect(input("/repo/src/two.ts"));
    expect(ensureExpandedForActiveFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(75);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledTimes(1);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledWith("/repo", "/repo/src/two.ts");
  });

  it("dedupes when active document path is unchanged", () => {
    const ensureExpandedForActiveFile = vi.fn(async () => {});
    const input: SyncActiveFileTreeExpandEffectInput = {
      activeDocumentPath: "/repo/src/main.ts",
      isChatHttpActive: false,
      activeWorkspaceRoot: "/repo",
      projectTreeController: {
        ensureExpandedForActiveFile,
      } as unknown as SyncActiveFileTreeExpandEffectInput["projectTreeController"],
    };

    syncActiveFileTreeExpandEffect(input);
    vi.advanceTimersByTime(75);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledTimes(1);

    syncActiveFileTreeExpandEffect(input);
    vi.advanceTimersByTime(75);
    expect(ensureExpandedForActiveFile).toHaveBeenCalledTimes(1);
  });
});

describe("syncProjectTreeWatcherEffect", () => {
  const syncWatcher = vi.mocked(syncProjectTreeWatcher);

  beforeEach(() => {
    resetAppShellEffectsForTests();
    syncWatcher.mockClear();
  });

  function makeInput(
    overrides: Partial<SyncProjectTreeWatcherEffectInput> & {
      loadProjectTreeRoot: () => Promise<void>;
      clearFilesystemChangeDebounce?: () => void;
    },
  ): SyncProjectTreeWatcherEffectInput {
    const clearFilesystemChangeDebounce = overrides.clearFilesystemChangeDebounce ?? vi.fn();
    return {
      runtimeReady: true,
      activeWorkspaceRoot: "/repo",
      isChatHttpActive: false,
      projectTreeController: {
        clearFilesystemChangeDebounce,
      } as unknown as SyncProjectTreeWatcherEffectInput["projectTreeController"],
      ...overrides,
    };
  }

  it("loads root and starts watcher once for a stable workspace", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});
    const input = makeInput({ loadProjectTreeRoot });

    syncProjectTreeWatcherEffect(input);
    syncProjectTreeWatcherEffect(input);
    syncProjectTreeWatcherEffect(input);

    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenCalledWith("/repo");
  });

  it("does not reload when only tab/session context would have re-run the effect", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});
    const input = makeInput({ loadProjectTreeRoot });

    syncProjectTreeWatcherEffect(input);
    // Same workspace/runtime/chat-http — simulates tab churn re-invoking the effect.
    syncProjectTreeWatcherEffect({ ...input });

    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenCalledTimes(1);
  });

  it("reloads exactly once when the workspace root changes", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});

    syncProjectTreeWatcherEffect(makeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-a" }));
    syncProjectTreeWatcherEffect(makeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-b" }));
    syncProjectTreeWatcherEffect(makeInput({ loadProjectTreeRoot, activeWorkspaceRoot: "/repo-b" }));

    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(2);
    expect(syncWatcher).toHaveBeenNthCalledWith(1, "/repo-a");
    expect(syncWatcher).toHaveBeenNthCalledWith(2, "/repo-b");
  });

  it("clears watcher when leaving workspace or entering chat-http", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});
    const clearFilesystemChangeDebounce = vi.fn();

    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, clearFilesystemChangeDebounce }),
    );
    syncProjectTreeWatcherEffect(
      makeInput({
        loadProjectTreeRoot,
        clearFilesystemChangeDebounce,
        isChatHttpActive: true,
      }),
    );
    // Redundant inactive transitions stay no-ops.
    syncProjectTreeWatcherEffect(
      makeInput({
        loadProjectTreeRoot,
        clearFilesystemChangeDebounce,
        activeWorkspaceRoot: null,
      }),
    );

    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
    expect(clearFilesystemChangeDebounce).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenNthCalledWith(1, "/repo");
    expect(syncWatcher).toHaveBeenNthCalledWith(2, null);
  });

  it("loads root before runtimeReady but defers watcher until ready", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});

    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, runtimeReady: false }),
    );
    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
    expect(syncWatcher).not.toHaveBeenCalled();

    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, runtimeReady: true }),
    );
    // Root already loaded for this workspace — only the watcher starts.
    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenCalledWith("/repo");
  });

  it("reloads root after leaving and re-entering the same workspace", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});
    const clearFilesystemChangeDebounce = vi.fn();

    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, clearFilesystemChangeDebounce }),
    );
    syncProjectTreeWatcherEffect(
      makeInput({
        loadProjectTreeRoot,
        clearFilesystemChangeDebounce,
        activeWorkspaceRoot: null,
      }),
    );
    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, clearFilesystemChangeDebounce }),
    );

    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(2);
  });

  it("does not reload root when toggling chat-http for the same workspace", () => {
    const loadProjectTreeRoot = vi.fn(async () => {});
    const clearFilesystemChangeDebounce = vi.fn();

    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, clearFilesystemChangeDebounce }),
    );
    syncProjectTreeWatcherEffect(
      makeInput({
        loadProjectTreeRoot,
        clearFilesystemChangeDebounce,
        isChatHttpActive: true,
      }),
    );
    syncProjectTreeWatcherEffect(
      makeInput({ loadProjectTreeRoot, clearFilesystemChangeDebounce }),
    );

    expect(loadProjectTreeRoot).toHaveBeenCalledTimes(1);
    expect(syncWatcher).toHaveBeenCalledWith(null);
    expect(syncWatcher).toHaveBeenLastCalledWith("/repo");
  });
});
