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

const sessionMock = createSessionFsMock();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: Parameters<typeof sessionMock.readTextFile>) =>
    sessionMock.readTextFile(...args),
  writeTextFile: (...args: Parameters<typeof sessionMock.writeTextFile>) =>
    sessionMock.writeTextFile(...args),
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
  syncOpenFileRegistryForWindow: vi.fn().mockResolvedValue(undefined),
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
    chatHttp: {
      documents: [
        {
          id: "doc-chat",
          filePath: null,
          title: "Untitled",
          content: "",
          savedContent: "",
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
        editorLayout: createSinglePaneLayout([createFileTab("tab-chat", "doc-chat")], "tab-chat"),
        lastActiveWindowId: "win-a",
        windowBounds: null,
      },
    },
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

  it("falls back to last active window snapshot when current window snapshot is missing", async () => {
    const snapshot = windowSnapshot();
    sessionMock.setSessionStore(sessionWithWindow("win-z", snapshot));
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");

    const restored = await sessionManager.restoreWindowSession("main");
    expect(restored?.snapshot.notepad.documents[0]?.content).toBe("saved");
    expect(restored?.snapshot.activeContextId).toBe("notepad");
  });

  it("preserves chat-http active context during restore sanitization", async () => {
    const snapshot = windowSnapshot({ activeContextId: "chat-http" });
    sessionMock.setSessionStore(sessionWithWindow("win-a", snapshot));
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");

    const restored = await sessionManager.restoreWindowSession("win-a");
    expect(restored?.snapshot.activeContextId).toBe("chat-http");
    expect(getSessionSelectedTabId(restored?.snapshot.chatHttp?.session as never)).toBe("tab-chat");
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
    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    expect(sessionMock.getSessionStore()?.windows["win-a"]).toBeDefined();
    expect(sessionMock.writeTextFile).toHaveBeenCalledWith(
      "/data/spec-ops/session.backup.json",
      expect.any(String),
    );
  });

  it("persists chat-http snapshot alongside notepad/workspaces", async () => {
    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");
    const persistedWindow = sessionMock.getSessionStore()?.windows["win-a"];
    expect(persistedWindow?.chatHttp).toBeDefined();
    expect(getSessionTabs(persistedWindow?.chatHttp?.session as never)).toHaveLength(1);
  });

  it("preserves global recent files when persisting a window snapshot", async () => {
    const initial = {
      ...sessionWithWindow("win-a", windowSnapshot()),
      recentFiles: ["/tmp/global.txt"],
    };
    sessionMock.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/session.json") || path.endsWith("/session.backup.json")) {
        return JSON.stringify(initial);
      }
      throw new Error(`unexpected read: ${path}`);
    });

    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    expect(sessionMock.getSessionStore()?.recentFiles).toEqual(["/tmp/global.txt"]);
  });
});

describe("persistGlobalRecentFiles", () => {
  it("updates only the global recent file list", async () => {
    const initial = sessionWithWindow("win-a", windowSnapshot());
    sessionMock.readTextFile.mockImplementation(async (path: string) => {
      if (path.endsWith("/session.json") || path.endsWith("/session.backup.json")) {
        return JSON.stringify(initial);
      }
      throw new Error(`unexpected read: ${path}`);
    });
    sessionMock.writeTextFile.mockClear();

    await sessionManager.persistGlobalRecentFiles(["/tmp/a.txt", "/tmp/b.txt"]);

    const sessionWriteCall = sessionMock.writeTextFile.mock.calls.find((call) =>
      String(call[0]).endsWith("/session.json"),
    );
    const written = JSON.parse(String(sessionWriteCall?.[1] ?? "{}"));
    expect(written.recentFiles).toEqual(["/tmp/a.txt", "/tmp/b.txt"]);
    expect(getSessionSelectedTabId(written.windows["win-a"]?.notepad.session as never)).toBe("tab-1");
  });
});

describe("scheduleSessionPersistence", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
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
