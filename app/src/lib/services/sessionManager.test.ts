import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDomainState, AppSessionSnapshot, WindowSessionSnapshot } from "../domain/contracts";
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

function windowSnapshot(overrides: Partial<WindowSessionSnapshot> = {}): WindowSessionSnapshot {
  return {
    documents: [
      {
        id: "doc-1",
        filePath: "/tmp/restored.txt",
        title: "restored.txt",
        content: "saved",
        savedContent: "saved",
        isDirty: false,
        language: "plaintext",
        encoding: "utf-8",
        lineEnding: "lf",
        diskFingerprint: null,
        dismissedFingerprint: null,
        fileMissing: false,
        scrollTop: 0,
      },
    ],
    session: {
      selectedTabId: "tab-1",
      openTabs: [{ id: "tab-1", documentId: "doc-1", pinned: false }],
      lastActiveWindowId: "win-a",
      windowBounds: null,
    },
    recentFiles: ["/tmp/restored.txt"],
    editor: {
      cursorLine: 1,
      cursorColumn: 1,
      zoomPercent: 100,
      wrapLines: true,
      findReplaceOpen: false,
      goToOpen: false,
      previewMode: "editor",
    },
    ...overrides,
  };
}

function sessionWithWindow(windowId: string, snapshot: WindowSessionSnapshot): AppSessionSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: windowId,
    openFileRegistry: {},
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
  });

  it("marks missing files on disk without dropping tabs", async () => {
    const snapshot = windowSnapshot();
    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.session.openTabs).toHaveLength(1);
    expect(sanitized.documents[0]?.fileMissing).toBe(true);
  });

  it("drops orphan tabs without linked documents", async () => {
    sessionMock.diskFiles.set("/tmp/restored.txt", "saved");
    const snapshot = windowSnapshot({
      session: {
        selectedTabId: "tab-1",
        openTabs: [
          { id: "tab-1", documentId: "doc-1", pinned: false },
          { id: "tab-2", documentId: "doc-missing", pinned: false },
        ],
        lastActiveWindowId: "win-a",
        windowBounds: null,
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.session.openTabs.map((tab) => tab.id)).toEqual(["tab-1"]);
  });

  it("creates a fallback untitled tab when no tabs remain", async () => {
    const snapshot = windowSnapshot({
      documents: [],
      session: {
        selectedTabId: "tab-1",
        openTabs: [{ id: "tab-1", documentId: "doc-missing", pinned: false }],
        lastActiveWindowId: "win-a",
        windowBounds: null,
      },
    });

    const sanitized = await sessionManager.sanitizeWindowSnapshot(snapshot);
    expect(sanitized.session.openTabs).toHaveLength(1);
    expect(sanitized.documents[0]?.title).toBe("Untitled");
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
    expect(restored?.documents[0]?.content).toBe("saved");
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
    expect(restored?.session.selectedTabId).toBe("tab-1");
  });

  it("returns null when both primary and backup fail", async () => {
    sessionMock.readTextFile.mockRejectedValue(new Error("missing"));
    await expect(sessionManager.restoreWindowSession("win-a")).resolves.toBeNull();
  });

  it("returns null for unsupported session versions", async () => {
    sessionMock.setSessionStore({
      version: 1,
      updatedAt: new Date().toISOString(),
      lastActiveWindowId: "win-a",
      openFileRegistry: {},
      windows: {},
    });
    sessionMock.readTextFile.mockResolvedValue(JSON.stringify({ version: 2, windows: {} }));

    await expect(sessionManager.restoreWindowSession("win-a")).resolves.toBeNull();
  });
});

describe("persistSessionSnapshot", () => {
  beforeEach(() => {
    sessionMock.setSessionStore(null);
    appState.resetWorkspace();
  });

  it("merges window state into session.json and writes backup", async () => {
    await sessionManager.persistSessionSnapshot(appState.getSnapshot(), "win-a");

    expect(sessionMock.getSessionStore()?.windows["win-a"]).toBeDefined();
    expect(sessionMock.writeTextFile).toHaveBeenCalledWith(
      "/data/spec-ops/session.backup.json",
      expect.any(String),
    );
  });
});

describe("scheduleSessionPersistence", () => {
  beforeEach(() => {
    sessionManager.resetSessionManagerForTests();
    sessionMock.setSessionStore(null);
    sessionMock.writeTextFile.mockClear();
    appState.resetWorkspace();
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
