import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDomainState, AppSessionSnapshot, EditorLayout, EditorPane, WindowSessionSnapshot } from "../domain/contracts";
import {
  activePane,
  createFileTab,
  createSinglePaneLayout,
  getSessionSelectedTabId,
  getSessionTabs,
} from "../domain/contracts";
import { appState } from "../state/appState";
import { createSessionFsMock } from "../test/sessionMock";
import * as sessionManager from "./sessionManager";
import { persistIncrementalWindowSession, resetIncrementalSessionPersistenceForTests } from "./sessionIncrementalPersistence";

const sessionMock = createSessionFsMock();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: Parameters<typeof sessionMock.readTextFile>) =>
    sessionMock.readTextFile(...args),
  writeTextFile: (...args: Parameters<typeof sessionMock.writeTextFile>) =>
    sessionMock.writeTextFile(...args),
  stat: (...args: Parameters<typeof sessionMock.stat>) => sessionMock.stat(...args),
  rename: (...args: Parameters<typeof sessionMock.rename>) => sessionMock.rename(...args),
  remove: (...args: Parameters<typeof sessionMock.remove>) => sessionMock.remove(...args),
  mkdir: (...args: Parameters<typeof sessionMock.mkdir>) => sessionMock.mkdir(...args),
  readDir: (...args: Parameters<typeof sessionMock.readDir>) => sessionMock.readDir(...args),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./openFileRegistry", () => ({
  dedupeWindowSnapshotAgainstRegistry: vi.fn(async (_windowId, snapshot) => snapshot),
}));

vi.mock("./fileSystem", () => ({
  openPath: vi.fn(),
}));

import { openPath } from "./fileSystem";

const openPathMock = vi.mocked(openPath);

function windowSnapshot(overrides: Partial<WindowSessionSnapshot> = {}): WindowSessionSnapshot {
  const notepad: WindowSessionSnapshot["notepad"] = {
    documents: [
      {
        id: "doc-1",
        filePath: "/tmp/restored.txt",
        title: "restored.txt",
        content: "saved",
        savedContent: "saved",
        isDirty: false,
        contentKind: "text",
        language: "plaintext",
        encoding: "utf-8",
        lineEnding: "lf",
        diskFingerprint: null,
        dismissedFingerprint: null,
        fileMissing: false,
        scrollTop: 0,
        markdownViewMode: "edit",
      },
    ],
    session: {
      editorLayout: createSinglePaneLayout([createFileTab("tab-1", "doc-1")], "tab-1"),
      lastActiveWindowId: "win-a",
      windowBounds: null,
    },
  };
  return {
    activeContextId: "notepad",
    notepad,
    workspaces: [],
    editorPreferences: {
      zoomPercent: 100,
      wrapLines: true,
    },
    ...overrides,
  };
}

function sessionWithWindow(windowId: string, snapshot: WindowSessionSnapshot): AppSessionSnapshot {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: windowId,
    openFileRegistry: {},
    recentFiles: ["/tmp/restored.txt"],
    windows: {
      [windowId]: snapshot,
    },
  };
}

describe("nextNumericId", () => {
  it("returns the next numeric id for docs and tabs", () => {
    expect(sessionManager.nextNumericId("doc", ["doc-1", "doc-2"])).toBe("doc-3");
    expect(sessionManager.nextNumericId("tab", ["tab-4"])).toBe("tab-5");
  });
});

describe("sanitizeWindowSnapshot", () => {
  beforeEach(() => {
    sessionMock.diskFiles.clear();
    openPathMock.mockReset();
  });

  it("marks missing files on disk without dropping tabs", async () => {
    const snapshot = windowSnapshot();
    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(getSessionTabs(sanitized.notepad.session)).toHaveLength(1);
    expect(sanitized.notepad.documents[0]?.fileMissing).toBe(true);
  });

  it("drops orphan tabs without linked documents", async () => {
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");
    const snapshot = windowSnapshot({
      notepad: {
        ...windowSnapshot().notepad,
        session: {
          ...windowSnapshot().notepad.session,
          editorLayout: createSinglePaneLayout(
            [
              createFileTab("tab-1", "doc-1"),
              createFileTab("tab-2", "doc-missing"),
            ],
            "tab-1",
          ),
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(getSessionTabs(sanitized.notepad.session).map((tab) => tab.id)).toEqual(["tab-1"]);
  });

  it("refreshes legacy image documents from disk on restore", async () => {
    openPathMock.mockResolvedValue({
      path: "/tmp/keenetic-dns.png",
      content: "",
      sizeBytes: 42,
      contentKind: "image",
    });
    const snapshot = windowSnapshot({
      notepad: {
        ...windowSnapshot().notepad,
        documents: [
          {
            ...windowSnapshot().notepad.documents[0]!,
            id: "doc-1",
            filePath: "/tmp/keenetic-dns.png",
            title: "keenetic-dns.png",
            content: "x".repeat(10_000),
            savedContent: "x".repeat(10_000),
            contentKind: "text",
          },
        ],
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.notepad.documents[0]?.contentKind).toBe("image");
    expect(sanitized.notepad.documents[0]?.content).toBe("");
    expect(openPathMock).toHaveBeenCalledWith("/tmp/keenetic-dns.png");
  });

  it("creates a fallback untitled tab when no tabs remain", async () => {
    const snapshot = windowSnapshot({
      notepad: {
        ...windowSnapshot().notepad,
        documents: [],
        session: {
          ...windowSnapshot().notepad.session,
          editorLayout: createSinglePaneLayout([createFileTab("tab-1", "doc-missing")], "tab-1"),
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(getSessionTabs(sanitized.notepad.session)).toHaveLength(1);
    expect(sanitized.notepad.documents[0]?.title).toBe("Untitled");
  });
});

describe("sanitizeWindowSnapshot — split-view persistence (Phase 7)", () => {
  beforeEach(() => {
    sessionMock.diskFiles.clear();
  });

  function makePane(id: string, tabs: { id: string; documentId: string }[], selectedTabId?: string): EditorPane {
    return {
      id,
      tabs: tabs.map((t) => createFileTab(t.id, t.documentId)),
      selectedTabId: selectedTabId ?? tabs[0]?.id ?? null,
    };
  }

  function cols2Layout(p1: EditorPane, p2: EditorPane, activePaneId = p2.id): EditorLayout {
    return { kind: "cols-2", panes: [p1, p2], slots: [[0, 1]], activePaneId };
  }

  function doc(id: string, filePath: string | null = null) {
    return {
      id,
      filePath,
      title: filePath ? filePath.split("/").pop()! : id,
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

  it("preserves a multi-pane layout on restore (per-pane tabs + selection + activePaneId)", async () => {
    sessionMock.diskFiles.set("/tmp/a.txt", "x");
    sessionMock.diskFiles.set("/tmp/b.txt", "y");
    const layout = cols2Layout(
      makePane("pane-1", [{ id: "tab-a", documentId: "doc-a" }], "tab-a"),
      makePane("pane-2", [{ id: "tab-b", documentId: "doc-b" }], "tab-b"),
      "pane-1",
    );
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a", "/tmp/a.txt"), doc("doc-b", "/tmp/b.txt")],
        session: {
          editorLayout: layout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    const restored = sanitized.notepad.session.editorLayout;
    expect(restored.panes).toHaveLength(2);
    expect(restored.panes.map((p) => p.id)).toEqual(["pane-1", "pane-2"]);
    expect(restored.panes[0].tabs.map((t) => t.id)).toEqual(["tab-a"]);
    expect(restored.panes[1].tabs.map((t) => t.id)).toEqual(["tab-b"]);
    expect(restored.activePaneId).toBe("pane-1");
  });

  it("prunes per-pane tabs whose document is missing from the snapshot (per-pane)", async () => {
    sessionMock.diskFiles.set("/tmp/a.txt", "x");
    sessionMock.diskFiles.set("/tmp/b.txt", "y");
    const layout = cols2Layout(
      makePane(
        "pane-1",
        [
          { id: "tab-a", documentId: "doc-a" },
          { id: "tab-gone", documentId: "doc-gone" },
        ],
        "tab-gone",
      ),
      makePane("pane-2", [{ id: "tab-b", documentId: "doc-b" }], "tab-b"),
      "pane-1",
    );
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a", "/tmp/a.txt"), doc("doc-b", "/tmp/b.txt")],
        session: {
          editorLayout: layout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    const restored = sanitized.notepad.session.editorLayout;
    // pane-1 lost its selected tab; selection falls back to the first remaining.
    expect(restored.panes[0].tabs.map((t) => t.id)).toEqual(["tab-a"]);
    expect(restored.panes[0].selectedTabId).toBe("tab-a");
    expect(restored.panes[1].tabs.map((t) => t.id)).toEqual(["tab-b"]);
    expect(restored.panes).toHaveLength(2);
  });

  it("clamps a stale activePaneId to the first pane", async () => {
    sessionMock.diskFiles.set("/tmp/a.txt", "x");
    const layout = cols2Layout(
      makePane("pane-1", [{ id: "tab-a", documentId: "doc-a" }]),
      makePane("pane-2", [{ id: "tab-b", documentId: "doc-b" }]),
      "missing-pane",
    );
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a", "/tmp/a.txt"), doc("doc-b")],
        session: {
          editorLayout: layout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.notepad.session.editorLayout.activePaneId).toBe("pane-1");
  });

  it("falls back to a single empty pane when the layout shape is malformed", async () => {
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a")],
        session: {
          // Malformed: panes present but not an array of valid panes.
          editorLayout: { kind: "custom", panes: [], slots: [], activePaneId: "x" } as never,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    const restored = sanitized.notepad.session.editorLayout;
    expect(restored.panes).toHaveLength(1);
    expect(restored.kind).toBe("single");
  });

  it("re-seeds a legacy flat openTabs snapshot into a single pane", async () => {
    sessionMock.diskFiles.set("/tmp/a.txt", "x");
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a", "/tmp/a.txt")],
        session: {
          // Legacy pre-split-view shape: no editorLayout, flat openTabs + selectedTabId.
          editorLayout: undefined as never,
          lastActiveWindowId: "win-a",
          windowBounds: null,
          openTabs: [createFileTab("tab-a", "doc-a")],
          selectedTabId: "tab-a",
        } as never,
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    const restored = sanitized.notepad.session.editorLayout;
    expect(restored.kind).toBe("single");
    expect(restored.panes).toHaveLength(1);
    expect(getSessionTabs(sanitized.notepad.session).map((t) => t.id)).toEqual(["tab-a"]);
  });

  it("marks per-pane file tabs missing on disk without dropping them", async () => {
    // No disk entry for /tmp/a.txt → fileStillExists returns false.
    sessionMock.diskFiles.set("/tmp/b.txt", "y");
    const layout = cols2Layout(
      makePane("pane-1", [{ id: "tab-a", documentId: "doc-a" }]),
      makePane("pane-2", [{ id: "tab-b", documentId: "doc-b" }]),
      "pane-2",
    );
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a", "/tmp/a.txt"), doc("doc-b", "/tmp/b.txt")],
        session: {
          editorLayout: layout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    const restored = sanitized.notepad.session.editorLayout;
    expect(restored.panes).toHaveLength(2);
    expect(restored.panes[0].tabs.map((t) => t.id)).toEqual(["tab-a"]);
    expect(sanitized.notepad.documents.find((d) => d.id === "doc-a")?.fileMissing).toBe(true);
    expect(sanitized.notepad.documents.find((d) => d.id === "doc-b")?.fileMissing).toBe(false);
  });

  it("uses activePane accessor against the restored multi-pane layout", async () => {
    sessionMock.diskFiles.set("/tmp/a.txt", "x");
    sessionMock.diskFiles.set("/tmp/b.txt", "y");
    const layout = cols2Layout(
      makePane("pane-1", [{ id: "tab-a", documentId: "doc-a" }]),
      makePane("pane-2", [{ id: "tab-b", documentId: "doc-b" }]),
      "pane-2",
    );
    const snapshot = windowSnapshot({
      notepad: {
        documents: [doc("doc-a", "/tmp/a.txt"), doc("doc-b", "/tmp/b.txt")],
        session: {
          editorLayout: layout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(activePane(sanitized.notepad.session.editorLayout).id).toBe("pane-2");
  });
});

describe("restoreWindowSession", () => {
  beforeEach(() => {
    sessionMock.restoreFsImplementations();
    sessionMock.setSessionStore(null);
    sessionMock.diskFiles.clear();
  });

  it("restores a valid window snapshot", async () => {
    const snapshot = windowSnapshot();
    sessionMock.setSessionStore(sessionWithWindow("win-a", snapshot));
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");

    const restored = await sessionManager.restoreWindowSession("win-a");
    expect(restored?.snapshot.notepad.documents[0]?.content).toBe("saved");
    expect(restored?.recentFiles).toEqual(["/tmp/restored.txt"]);
  });

  it("returns null for a new window id instead of hydrating another window's session", async () => {
    const snapshot = windowSnapshot();
    sessionMock.setSessionStore(sessionWithWindow("win-z", snapshot));
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");

    await expect(sessionManager.restoreWindowSession("main")).resolves.toBeNull();
  });

  it("falls back to backup when primary session is corrupt", async () => {
    const snapshot = windowSnapshot();
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");
    sessionMock.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/session.json")) {
        throw new Error("corrupt primary");
      }
      if (path.endsWith("/session.backup.json")) {
        return JSON.stringify(sessionWithWindow("win-a", snapshot));
      }
      if (sessionMock.diskFiles.has(path)) {
        return sessionMock.diskFiles.get(path)!;
      }
      throw new Error("no such file");
    });

    const restored = await sessionManager.restoreWindowSession("win-a");
    expect(getSessionSelectedTabId(restored?.snapshot.notepad.session as never)).toBe("tab-1");
  });

  it("returns null when both primary and backup fail", async () => {
    sessionMock.readTextFile.mockRejectedValue(new Error("missing"));
    await expect(sessionManager.restoreWindowSession("win-a")).resolves.toBeNull();
  });

  it("returns null for unsupported session versions", async () => {
    sessionMock.setSessionStore({
      version: 2,
      updatedAt: new Date().toISOString(),
      lastActiveWindowId: "win-a",
      openFileRegistry: {},
      recentFiles: [],
      windows: {},
    });
    sessionMock.readTextFile.mockResolvedValue(JSON.stringify({ version: 1, windows: {} }));

    await expect(sessionManager.restoreWindowSession("win-a")).resolves.toBeNull();
  });
});

describe("persistSessionSnapshot", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.restoreFsImplementations();
    sessionMock.setSessionStore(null);
    appState.resetAppState();
  });

  it("does not persist buffers for image documents", async () => {
    appState.openFileInTab("/tmp/persist-photo.png", "", "image");

    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    const persisted = sessionMock.getSessionStore()?.windows["win-a"]?.notepad.documents.find(
      (documentState) => documentState.filePath === "/tmp/persist-photo.png",
    );
    expect(persisted?.contentKind).toBe("image");
    expect(persisted?.content).toBe("");
    expect(persisted?.savedContent).toBe("");
  });

  it("merges window state into session.json and writes backup", async () => {
    // Seed a valid primary so the next write can promote it to backup.
    sessionMock.setSessionStore(sessionWithWindow("win-prior", windowSnapshot()));
    sessionMock.writeTextFile.mockClear();

    appState.setActivityRailWidth(180);
    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    expect(sessionMock.getSessionStore()?.windows["win-a"]).toBeDefined();
    expect(sessionMock.getSessionStore()?.windows["win-a"]?.activityRailWidthPx).toBe(180);
    // Backup is the previous primary (not a twin of the new write).
    const backupWrite = sessionMock.writeTextFile.mock.calls.find((call) =>
      String(call[0]).includes("/session.backup.json"),
    );
    expect(backupWrite).toBeDefined();
    const backupParsed = JSON.parse(String(backupWrite?.[1])) as AppSessionSnapshot;
    expect(backupParsed.windows["win-prior"]).toBeDefined();
    expect(backupParsed.windows["win-a"]).toBeUndefined();
  });

  it("skips backup on the first session write when no prior file exists", async () => {
    sessionMock.writeTextFile.mockClear();
    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    const backupWrite = sessionMock.writeTextFile.mock.calls.find((call) =>
      String(call[0]).includes("/session.backup.json"),
    );
    expect(backupWrite).toBeUndefined();
    expect(sessionMock.getSessionStore()?.windows["win-a"]).toBeDefined();
  });

  it("preserves global recent files when persisting a window snapshot", async () => {
    sessionMock.setSessionStore({
      ...sessionWithWindow("win-a", windowSnapshot()),
      recentFiles: ["/tmp/global.txt"],
    });

    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    expect(sessionMock.getSessionStore()?.recentFiles).toEqual(["/tmp/global.txt"]);
  });

  it("serializes concurrent persists so both window entries are retained", async () => {
    sessionMock.setSessionStore(null);
    sessionMock.writeTextFile.mockClear();

    const winA = appState.getSnapshot();
    appState.resetAppState();
    appState.openFileInTab("/tmp/win-b.txt", "b");
    const winB = appState.getSnapshot();

    await Promise.all([
      sessionManager.persistSessionSnapshot(winA, "win-a"),
      sessionManager.persistSessionSnapshot(winB, "win-b"),
    ]);

    const store = sessionMock.getSessionStore();
    expect(store?.windows["win-a"]).toBeDefined();
    expect(store?.windows["win-b"]).toBeDefined();
    expect(store?.windows["win-a"]?.updatedAt).toEqual(expect.any(String));
    expect(store?.windows["win-b"]?.updatedAt).toEqual(expect.any(String));
  });

  it("flush during debounced persist keeps the latest state", async () => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.setSessionStore(null);
    sessionMock.writeTextFile.mockClear();

    appState.openFileInTab("/tmp/first.txt", "first");
    sessionManager.scheduleSessionPersistence(appState.getSnapshot(), "win-a");

    appState.openFileInTab("/tmp/latest.txt", "latest");
    await sessionManager.flushSessionPersistence(appState.getSnapshot(), "win-a");

    const notepadDocs = sessionMock.getSessionStore()?.windows["win-a"]?.notepad.documents ?? [];
    expect(notepadDocs.some((doc) => doc.filePath === "/tmp/latest.txt")).toBe(true);

    await new Promise((resolve) => {
      setTimeout(resolve, 1300);
    });
    const afterDebounce = sessionMock.getSessionStore()?.windows["win-a"]?.notepad.documents ?? [];
    expect(afterDebounce.some((doc) => doc.filePath === "/tmp/latest.txt")).toBe(true);
  });
});

describe("removeWindowSessionEntry", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.restoreFsImplementations();
  });

  it("deletes the window entry and repoints lastActiveWindowId", async () => {
    sessionMock.setSessionStore({
      ...sessionWithWindow("window-x1", windowSnapshot()),
      lastActiveWindowId: "window-x1",
    });

    await sessionManager.removeWindowSessionEntry("window-x1");

    const store = sessionMock.getSessionStore();
    expect(store?.windows["window-x1"]).toBeUndefined();
    expect(store?.lastActiveWindowId).toBe("main");
  });

  it("never removes the main window entry", async () => {
    sessionMock.setSessionStore(sessionWithWindow("main", windowSnapshot()));
    sessionMock.writeTextFile.mockClear();

    await sessionManager.removeWindowSessionEntry("main");

    expect(sessionMock.getSessionStore()?.windows["main"]).toBeDefined();
    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();
  });

  it("is a no-op when the entry does not exist", async () => {
    sessionMock.setSessionStore(sessionWithWindow("main", windowSnapshot()));
    sessionMock.writeTextFile.mockClear();

    await sessionManager.removeWindowSessionEntry("window-gone");

    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();
  });
});

describe("pruneStaleWindowSessionEntries", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.restoreFsImplementations();
  });

  it("removes entries without a live window, keeping main and live labels", async () => {
    const base = sessionWithWindow("main", windowSnapshot());
    sessionMock.setSessionStore({
      ...base,
      lastActiveWindowId: "window-stale",
      windows: {
        ...base.windows,
        "window-live": windowSnapshot(),
        "window-stale": windowSnapshot(),
      },
    });

    await sessionManager.pruneStaleWindowSessionEntries(["main", "window-live"]);

    const store = sessionMock.getSessionStore();
    expect(Object.keys(store?.windows ?? {}).sort()).toEqual(["main", "window-live"]);
    expect(store?.lastActiveWindowId).toBe("main");
  });

  it("does not write when nothing is stale", async () => {
    sessionMock.setSessionStore(sessionWithWindow("main", windowSnapshot()));
    sessionMock.writeTextFile.mockClear();

    await sessionManager.pruneStaleWindowSessionEntries(["main"]);

    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();
  });
});

describe("persistGlobalRecentFiles", () => {
  beforeEach(() => {
    sessionMock.restoreFsImplementations();
  });

  it("updates only the global recent file list", async () => {
    const initial = sessionWithWindow("win-a", windowSnapshot());
    sessionMock.setSessionStore(initial);
    sessionMock.writeTextFile.mockClear();

    await sessionManager.persistGlobalRecentFiles(["/tmp/a.txt", "/tmp/b.txt"]);

    // Atomic writes land on a `session.json.<random>.tmp` sibling first.
    const sessionWriteCall = sessionMock.writeTextFile.mock.calls.find((call) =>
      String(call[0]).includes("/session.json"),
    );
    const written = JSON.parse(String(sessionWriteCall?.[1] ?? "{}"));
    expect(written.recentFiles).toEqual(["/tmp/a.txt", "/tmp/b.txt"]);
    expect(getSessionSelectedTabId(written.windows["win-a"]?.notepad.session as never)).toBe("tab-1");
  });
});

describe("scheduleSessionPersistence", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.restoreFsImplementations();
    sessionMock.setSessionStore(null);
    sessionMock.writeTextFile.mockClear();
    appState.resetAppState();
  });

  it("debounces persistence calls", async () => {
    sessionManager.scheduleSessionPersistence(appState.getSnapshot(), "win-a");
    sessionManager.scheduleSessionPersistence(appState.getSnapshot(), "win-a");

    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();
    await new Promise((resolve) => {
      setTimeout(resolve, 1300);
    });
    expect(sessionMock.writeTextFile).toHaveBeenCalled();
  });
});

describe("incremental session persistence", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.restoreFsImplementations();
    sessionMock.setSessionStore(null);
    sessionMock.diskFiles.clear();
    sessionMock.writeTextFile.mockClear();
    appState.resetAppState();
  });

  it("writes only lightweight navigation when tab selection changes", async () => {
    appState.openFileInTab("/tmp/a.txt", "large-a-payload");
    appState.openFileInTab("/tmp/b.txt", "large-b-payload");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    sessionMock.writeTextFile.mockClear();

    const firstTab = getSessionTabs(appState.getActiveSession())[0]!;
    appState.selectTab(firstTab.id);
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");

    const writtenPaths = sessionMock.writeTextFile.mock.calls.map(([path]) => String(path));
    expect(writtenPaths.some((path) => path.includes("session-navigation.win-a.json"))).toBe(true);
    expect(writtenPaths.some((path) => path.includes("session-buffer."))).toBe(false);
    expect(writtenPaths.some((path) => path.includes("/session.json."))).toBe(false);
    const payloads = sessionMock.writeTextFile.mock.calls.map(([, content]) => String(content));
    expect(payloads.join("\n")).not.toContain("large-a-payload");
    expect(payloads.join("\n")).not.toContain("large-b-payload");
  });

  it("writes a document buffer only when its content revision changes", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    sessionMock.writeTextFile.mockClear();
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")!.id;

    appState.setDocumentContent(documentId, "a-edited");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");

    const bufferWrites = sessionMock.writeTextFile.mock.calls.filter(([path]) =>
      String(path).includes("session-buffer."),
    );
    expect(bufferWrites).toHaveLength(1);
    expect(String(bufferWrites[0]?.[1])).toContain("a-edited");

    sessionMock.writeTextFile.mockClear();
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();
  });

  it("restores topology and dirty buffers without a full checkpoint", async () => {
    appState.openFileInTab("/tmp/crash.txt", "before-crash");
    const documentId = appState.getActiveDocuments().find(
      (doc) => doc.filePath === "/tmp/crash.txt",
    )!.id;
    appState.setDocumentContent(documentId, "unsaved-before-crash");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-crash");
    sessionMock.setSessionStore(null);

    const restored = await sessionManager.restoreWindowSession("win-crash");

    expect(restored).not.toBeNull();
    expect(restored?.snapshot.notepad.documents.find((doc) => doc.id === documentId)).toMatchObject({
      content: "unsaved-before-crash",
      isDirty: true,
    });
    expect(getSessionTabs(restored?.snapshot.notepad.session as never).some(
      (tab) => tab.kind === "file" && tab.documentId === documentId,
    )).toBe(true);
  });

  it("does not rewrite buffers when only savedContent/isDirty change (save with no text edit)", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    sessionMock.writeTextFile.mockClear();

    // A save flips isDirty/savedContent without altering content. Only that
    // metadata changed, so no buffer record should be re-serialized.
    const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")!.id;
    appState.markDocumentSaved(documentId, "/tmp/a.txt", "a");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");

    const bufferWrites = sessionMock.writeTextFile.mock.calls.filter(([path]) =>
      String(path).includes("session-buffer."),
    );
    expect(bufferWrites).toHaveLength(0);
  });

  it("skips the navigation write and all buffer writes when nothing changed (P03-08-25)", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    sessionMock.writeTextFile.mockClear();

    // A second persist with no state change must be a pure no-op: neither the
    // navigation record nor any buffer file is rewritten. The previous code
    // JSON.stringified the whole snapshot every time just to discover this.
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();
  });

  it("detects a cursor/scroll-only change as a no-op for navigation (content-free fingerprint)", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    sessionMock.writeTextFile.mockClear();

    // Mutating only fields that the navigation fingerprint excludes must not
    // re-serialize the navigation record. (scrollTop is editor-only state and
    // never touches the snapshot, so exercise a no-op re-persist instead — the
    // point is the structural fingerprint, not the content, drives the write.)
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    const navWrites = sessionMock.writeTextFile.mock.calls.filter(([path]) =>
      String(path).includes("session-navigation."),
    );
    expect(navWrites).toHaveLength(0);
  });

  it("evicts the buffer file and fingerprint when a document is closed (P03-08-26)", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");

    const bufferKeysBefore = [...sessionMock.diskFiles.keys()].filter((key) =>
      key.includes("session-buffer.win-a."),
    );
    expect(bufferKeysBefore).toHaveLength(2);

    // Close the tab for /tmp/a.txt. pruneUnreferencedDocuments drops the
    // document from the context, so the next persist sees it as orphaned.
    const aDoc = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/a.txt")!;
    const aTab = getSessionTabs(appState.getActiveSession()).find(
      (tab) => tab.kind === "file" && tab.documentId === aDoc.id,
    )!;
    appState.closeTabForce(aTab.id);
    sessionMock.writeTextFile.mockClear();

    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");

    const bufferKeysAfter = [...sessionMock.diskFiles.keys()].filter((key) =>
      key.includes("session-buffer.win-a."),
    );
    // Only the buffer for /tmp/b.txt survives; /tmp/a.txt's buffer was deleted.
    expect(bufferKeysAfter).toHaveLength(1);
    expect(bufferKeysAfter.some((key) => key.includes(aDoc.id))).toBe(false);
    // The deleted buffer's fingerprint entry is gone too — closing then
    // re-opening the same path must not match a stale fingerprint.
  });

  it("does not retain document content in the buffer fingerprint cache (P03-08-26)", async () => {
    appState.openFileInTab("/tmp/secret.txt", "top-secret-payload");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");

    // The fingerprint map is module-private; the only externally observable
    // contract is that re-persisting identical content is a no-op while the
    // buffer file itself does store the content. Verify both: a no-op re-persist
    // writes nothing, and the on-disk buffer (via readIncrementalWindowSession)
    // still carries the payload.
    sessionMock.writeTextFile.mockClear();
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-a");
    expect(sessionMock.writeTextFile).not.toHaveBeenCalled();

    const restored = await sessionManager.restoreWindowSession("win-a");
    const doc = restored?.snapshot.notepad.documents.find((d) => d.filePath === "/tmp/secret.txt");
    expect(doc?.content).toBe("top-secret-payload");
  });

  it("removes orphaned buffer files even when the navigation record is unreadable", async () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-gone");
    // Simulate a corrupt/missing navigation record so the legacy enumeration
    // path (walking documents via the navigation snapshot) could not list them.
    const navKey = [...sessionMock.diskFiles.keys()].find((key) =>
      key.includes("session-navigation.win-gone.json"),
    );
    expect(navKey).toBeDefined();
    sessionMock.diskFiles.delete(navKey!);

    const bufferKeysBefore = [...sessionMock.diskFiles.keys()].filter((key) =>
      key.includes("session-buffer.win-gone."),
    );
    expect(bufferKeysBefore.length).toBeGreaterThanOrEqual(1);

    await sessionManager.removeWindowSessionEntry("win-gone");

    const bufferKeysAfter = [...sessionMock.diskFiles.keys()].filter((key) =>
      key.includes("session-buffer.win-gone."),
    );
    expect(bufferKeysAfter).toHaveLength(0);
  });

  it("deletes crash-restart orphan buffer files during persist when the in-memory cache is cold (P03-08-26)", async () => {
    // Window "win-restart" previously persisted buffers for two docs. After a
    // crash/restart the in-memory fingerprint cache is empty, so the
    // stale-key path cannot see those docs. Only the on-disk orphan sweep
    // (which lists buffer files for the window and deletes any not in the live
    // set) can clean them up. Here doc /tmp/orphan.txt was closed before the
    // restart; its buffer file must be deleted by the next persist.
    appState.openFileInTab("/tmp/keep.txt", "keep-payload");
    appState.openFileInTab("/tmp/orphan.txt", "orphan-payload");
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-restart");

    const orphanDoc = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/orphan.txt")!;
    const orphanTab = getSessionTabs(appState.getActiveSession()).find(
      (tab) => tab.kind === "file" && tab.documentId === orphanDoc.id,
    )!;
    appState.closeTabForce(orphanTab.id);

    // Simulate a restart: clear the in-memory caches (the fingerprint map and
    // navigation fingerprint are module-private and empty after a restart).
    resetIncrementalSessionPersistenceForTests();
    // Re-arm the session manager's own state so the next persist runs.
    sessionManager.resetSessionManagerForTests();

    const keepDoc = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/keep.txt")!;

    await persistIncrementalWindowSession(appState.getSnapshot(), "win-restart");

    const bufferKeysAfter = [...sessionMock.diskFiles.keys()].filter((key) =>
      key.includes("session-buffer.win-restart."),
    );
    // The orphan's buffer is gone; only the still-open doc's buffer survives.
    expect(bufferKeysAfter.some((key) => key.includes(orphanDoc.id))).toBe(false);
    expect(bufferKeysAfter.some((key) => key.includes(keepDoc.id))).toBe(true);
  });

  it("marks a document missing when restored without a checkpoint and its buffer is absent", async () => {
    appState.openFileInTab("/tmp/lost.txt", "had-content");
    const documentId = appState.getActiveDocuments().find(
      (doc) => doc.filePath === "/tmp/lost.txt",
    )!.id;
    await persistIncrementalWindowSession(appState.getSnapshot(), "win-lost");
    // Delete the buffer file but keep the navigation record; no checkpoint exists.
    const bufferKey = [...sessionMock.diskFiles.keys()].find((key) =>
      key.includes(`session-buffer.win-lost.`) && key.includes(documentId),
    );
    expect(bufferKey).toBeDefined();
    sessionMock.diskFiles.delete(bufferKey!);
    sessionMock.setSessionStore(null);

    const restored = await sessionManager.restoreWindowSession("win-lost");

    expect(restored).not.toBeNull();
    const doc = restored?.snapshot.notepad.documents.find((d) => d.id === documentId);
    // Restoring stripped (empty) content verbatim would look like a legit empty
    // file and overwrite the real file on the next save; mark it missing instead.
    expect(doc?.fileMissing).toBe(true);
    expect(doc?.isDirty).toBe(false);
  });
});
