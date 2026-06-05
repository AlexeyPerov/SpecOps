import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDomainState, AppSessionSnapshot, WindowSessionSnapshot } from "../domain/contracts";
import { createFileTab } from "../domain/contracts";
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
      selectedTabId: "tab-1",
      openTabs: [createFileTab("tab-1", "doc-1")],
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
        selectedTabId: "tab-chat",
        openTabs: [createFileTab("tab-chat", "doc-chat")],
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
    expect(sanitized.notepad.session.openTabs).toHaveLength(1);
    expect(sanitized.notepad.documents[0]?.fileMissing).toBe(true);
  });

  it("drops orphan tabs without linked documents", async () => {
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");
    const snapshot = windowSnapshot({
      notepad: {
        ...windowSnapshot().notepad,
        session: {
          ...windowSnapshot().notepad.session,
          selectedTabId: "tab-1",
          openTabs: [
            createFileTab("tab-1", "doc-1"),
            createFileTab("tab-2", "doc-missing"),
          ],
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.notepad.session.openTabs.map((tab) => tab.id)).toEqual(["tab-1"]);
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
          selectedTabId: "tab-1",
          openTabs: [createFileTab("tab-1", "doc-missing")],
        },
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.notepad.session.openTabs).toHaveLength(1);
    expect(sanitized.notepad.documents[0]?.title).toBe("Untitled");
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

  it("preserves chat-http active context during restore sanitization", async () => {
    const snapshot = windowSnapshot({ activeContextId: "chat-http" });
    sessionMock.setSessionStore(sessionWithWindow("win-a", snapshot));
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");

    const restored = await sessionManager.restoreWindowSession("win-a");
    expect(restored?.snapshot.activeContextId).toBe("chat-http");
    expect(restored?.snapshot.chatHttp?.session.selectedTabId).toBe("tab-chat");
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
    expect(restored?.snapshot.notepad.session.selectedTabId).toBe("tab-1");
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
    expect(persistedWindow?.chatHttp?.session.openTabs).toHaveLength(1);
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
    expect(written.windows["win-a"]?.notepad.session.selectedTabId).toBe("tab-1");
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
