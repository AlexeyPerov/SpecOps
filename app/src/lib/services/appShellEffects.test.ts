import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fileWatcher", () => ({
  syncProjectTreeWatcher: vi.fn(async () => {}),
}));

import { syncProjectTreeWatcher } from "./fileWatcher";
import {
  resetAppShellEffectsForTests,
  syncActiveFileTreeExpandEffect,
  syncExternalFileWatcherEffect,
  syncProjectTreeWatcherEffect,
  type SyncActiveFileTreeExpandEffectInput,
  type SyncExternalFileWatcherEffectInput,
  type SyncProjectTreeWatcherEffectInput,
} from "./appShellEffects";
import type { AppDomainState, TabState } from "../domain/contracts";
import { createFileTab, createSessionTab, createSinglePaneLayout } from "../domain/contracts";
import { externalFileWatcherSyncKey } from "./appShellHelpers";

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

function watcherDomainState(overrides: {
  openTabs?: TabState[];
  documents?: AppDomainState["contexts"]["notepad"]["documents"];
  watchExternalChanges?: boolean;
}): AppDomainState {
  const snapshot = {
    documents: overrides.documents ?? [],
    session: {
      editorLayout: createSinglePaneLayout(overrides.openTabs ?? [], null),
      lastActiveWindowId: "main",
      windowBounds: null,
    },
  };
  return {
    contexts: {
      activeContextId: "notepad",
      notepad: snapshot,
      chatHttp: snapshot,
      workspaces: [],
    },
    settings: {
      externalFiles: {
        watchExternalChanges: overrides.watchExternalChanges ?? true,
      },
    } as AppDomainState["settings"],
    theme: {} as AppDomainState["theme"],
    recentFiles: [],
    editor: {} as AppDomainState["editor"],
    activityRailWidthPx: 48,
  };
}

function watcherDocument(id: string, filePath: string | null) {
  return {
    id,
    filePath,
    title: "title",
    content: "",
    savedContent: "",
    isDirty: false,
    contentKind: "text" as const,
    language: "plaintext",
    encoding: "utf-8" as const,
    lineEnding: "lf" as const,
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit" as const,
  };
}

describe("syncExternalFileWatcherEffect", () => {
  beforeEach(() => {
    resetAppShellEffectsForTests();
  });

  function makeInput(
    overrides: Partial<SyncExternalFileWatcherEffectInput> & {
      syncExternalFileWatcher: (state: AppDomainState) => Promise<void>;
      snapshot?: AppDomainState;
    },
  ): SyncExternalFileWatcherEffectInput {
    return {
      runtimeReady: true,
      snapshot:
        overrides.snapshot ??
        watcherDomainState({
          openTabs: [createFileTab("tab-1", "doc-1")],
          documents: [watcherDocument("doc-1", "/tmp/a.txt")],
        }),
      ...overrides,
    };
  }

  it("syncs once for a stable watch key and skips redundant re-runs", () => {
    const syncExternalFileWatcher = vi.fn(async () => {});
    const input = makeInput({ syncExternalFileWatcher });

    syncExternalFileWatcherEffect(input);
    syncExternalFileWatcherEffect(input);
    syncExternalFileWatcherEffect({ ...input });

    expect(syncExternalFileWatcher).toHaveBeenCalledTimes(1);
  });

  it("does not sync when only non-path document fields change", () => {
    const syncExternalFileWatcher = vi.fn(async () => {});
    const base = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt")],
    });
    const edited = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [{ ...watcherDocument("doc-1", "/tmp/a.txt"), content: "edited", isDirty: true }],
    });

    expect(externalFileWatcherSyncKey(base)).toBe(externalFileWatcherSyncKey(edited));

    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: base }));
    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: edited }));

    expect(syncExternalFileWatcher).toHaveBeenCalledTimes(1);
  });

  it("re-syncs when a watched path changes", () => {
    const syncExternalFileWatcher = vi.fn(async () => {});
    const withA = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt")],
    });
    const withB = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/b.txt")],
    });

    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: withA }));
    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: withB }));

    expect(syncExternalFileWatcher).toHaveBeenCalledTimes(2);
  });

  it("re-syncs when watchExternalChanges toggles", () => {
    const syncExternalFileWatcher = vi.fn(async () => {});
    const enabled = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt")],
      watchExternalChanges: true,
    });
    const disabled = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt")],
      watchExternalChanges: false,
    });

    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: enabled }));
    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: disabled }));

    expect(syncExternalFileWatcher).toHaveBeenCalledTimes(2);
  });

  it("re-syncs when a file tab is opened or closed", () => {
    const syncExternalFileWatcher = vi.fn(async () => {});
    const oneTab = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt"), watcherDocument("doc-2", "/tmp/b.txt")],
    });
    const twoTabs = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1"), createFileTab("tab-2", "doc-2")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt"), watcherDocument("doc-2", "/tmp/b.txt")],
    });
    const agentOnly = watcherDomainState({
      openTabs: [createSessionTab("tab-agent", "agent-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt")],
    });

    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: oneTab }));
    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: twoTabs }));
    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot: agentOnly }));

    expect(syncExternalFileWatcher).toHaveBeenCalledTimes(3);
  });

  it("skips when runtime is not ready and syncs after ready", () => {
    const syncExternalFileWatcher = vi.fn(async () => {});
    const snapshot = watcherDomainState({
      openTabs: [createFileTab("tab-1", "doc-1")],
      documents: [watcherDocument("doc-1", "/tmp/a.txt")],
    });

    syncExternalFileWatcherEffect(
      makeInput({ syncExternalFileWatcher, snapshot, runtimeReady: false }),
    );
    expect(syncExternalFileWatcher).not.toHaveBeenCalled();

    syncExternalFileWatcherEffect(makeInput({ syncExternalFileWatcher, snapshot }));
    expect(syncExternalFileWatcher).toHaveBeenCalledTimes(1);
  });
});
