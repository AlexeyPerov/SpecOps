import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppDomainState,
  AppSessionSnapshot,
  OpenFileRegistry,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { createSessionFsMock } from "../test/sessionMock";
import {
  applyRegistryDedupeToWindowSnapshot,
  claimOpenFile,
  readOpenFileRegistry,
  releaseAllOpenFilesForWindow,
  renameOpenFileRegistry,
  syncOpenFileRegistryForWindow,
} from "./openFileRegistry";

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

function baseWindowSnapshot(overrides: Partial<WindowSessionSnapshot> = {}): WindowSessionSnapshot {
  return {
    documents: [
      {
        id: "doc-1",
        filePath: "/tmp/shared.txt",
        title: "shared.txt",
        content: "content",
        savedContent: "content",
        isDirty: false,
        language: "plaintext",
        encoding: "utf-8",
        lineEnding: "lf",
        diskFingerprint: null,
        dismissedFingerprint: null,
        fileMissing: false,
        scrollTop: 0,
      },
      {
        id: "doc-2",
        filePath: null,
        title: "Untitled",
        content: "",
        savedContent: "",
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
      openTabs: [
        { id: "tab-1", documentId: "doc-1", pinned: false },
        { id: "tab-2", documentId: "doc-2", pinned: false },
      ],
      lastActiveWindowId: "win-a",
      windowBounds: null,
    },
    recentFiles: [],
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

function emptySession(): AppSessionSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: "main",
    openFileRegistry: {},
    windows: {},
  };
}

describe("readOpenFileRegistry", () => {
  beforeEach(() => {
    sessionMock.setSessionStore(null);
    sessionMock.readTextFile.mockClear();
    sessionMock.writeTextFile.mockClear();
  });

  it("returns an empty registry when session file is missing", async () => {
    await expect(readOpenFileRegistry()).resolves.toEqual({});
  });

  it("returns registry entries from session.json", async () => {
    sessionMock.setSessionStore({
      ...emptySession(),
      openFileRegistry: {
        "/tmp/a.txt": { windowId: "win-a", documentId: "doc-1" },
      },
    });

    await expect(readOpenFileRegistry()).resolves.toEqual({
      "/tmp/a.txt": { windowId: "win-a", documentId: "doc-1" },
    });
  });
});

describe("claimOpenFile", () => {
  beforeEach(() => {
    sessionMock.setSessionStore(emptySession());
  });

  it("writes a normalized registry entry", async () => {
    await claimOpenFile("/tmp/claim.txt", "win-a", "doc-9");
    expect(sessionMock.getSessionStore()?.openFileRegistry).toEqual({
      "/tmp/claim.txt": { windowId: "win-a", documentId: "doc-9" },
    });
  });
});

describe("syncOpenFileRegistryForWindow", () => {
  beforeEach(() => {
    sessionMock.setSessionStore({
      ...emptySession(),
      openFileRegistry: {
        "/tmp/old.txt": { windowId: "win-a", documentId: "doc-old" },
        "/tmp/other-window.txt": { windowId: "win-b", documentId: "doc-x" },
      },
    });
  });

  it("replaces only the target window entries with current saved tabs", async () => {
    const state: AppDomainState = {
      documents: [
        {
          id: "doc-1",
          filePath: "/tmp/new.txt",
          title: "new.txt",
          content: "",
          savedContent: "",
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
      settings: {
        themeMode: "dark",
        accent: "blue",
        statusBarVisible: true,
        externalFiles: {
          watchExternalChanges: true,
          autoReloadCleanFiles: true,
          checkOnWindowFocus: true,
          checkOnTabActivate: true,
        },
      },
      recentFiles: [],
      editor: {
        cursorLine: 1,
        cursorColumn: 1,
        zoomPercent: 100,
        wrapLines: true,
        findReplaceOpen: false,
        goToOpen: false,
        previewMode: "editor",
      },
    };

    await syncOpenFileRegistryForWindow("win-a", state);

    expect(sessionMock.getSessionStore()?.openFileRegistry).toEqual({
      "/tmp/other-window.txt": { windowId: "win-b", documentId: "doc-x" },
      "/tmp/new.txt": { windowId: "win-a", documentId: "doc-1" },
    });
  });
});

describe("releaseAllOpenFilesForWindow", () => {
  it("removes only entries owned by the given window", async () => {
    sessionMock.setSessionStore({
      ...emptySession(),
      openFileRegistry: {
        "/tmp/a.txt": { windowId: "win-a", documentId: "doc-1" },
        "/tmp/b.txt": { windowId: "win-b", documentId: "doc-2" },
      },
    });

    await releaseAllOpenFilesForWindow("win-a");

    expect(sessionMock.getSessionStore()?.openFileRegistry).toEqual({
      "/tmp/b.txt": { windowId: "win-b", documentId: "doc-2" },
    });
  });
});

describe("renameOpenFileRegistry", () => {
  beforeEach(() => {
    sessionMock.setSessionStore({
      ...emptySession(),
      openFileRegistry: {
        "/tmp/old.txt": { windowId: "win-a", documentId: "doc-1" },
      },
    });
  });

  it("moves registry ownership to the new path", async () => {
    await renameOpenFileRegistry("/tmp/old.txt", "/tmp/new.txt", "win-a", "doc-1");
    expect(sessionMock.getSessionStore()?.openFileRegistry).toEqual({
      "/tmp/new.txt": { windowId: "win-a", documentId: "doc-1" },
    });
  });
});

describe("applyRegistryDedupeToWindowSnapshot", () => {
  it("drops tabs for paths owned by another window", () => {
    const registry: OpenFileRegistry = {
      "/tmp/shared.txt": { windowId: "win-b", documentId: "doc-9" },
    };
    const snapshot = baseWindowSnapshot();

    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, "win-a", snapshot);

    expect(nextSnapshot.session.openTabs.map((tab) => tab.id)).toEqual(["tab-2"]);
    expect(nextSnapshot.session.selectedTabId).toBe("tab-2");
    expect(nextSnapshot.documents.map((doc) => doc.id)).toEqual(["doc-2"]);
    expect(nextRegistry["/tmp/shared.txt"]).toEqual({ windowId: "win-b", documentId: "doc-9" });
  });

  it("keeps untitled tabs and claims saved tabs for the restoring window", () => {
    const registry: OpenFileRegistry = {};
    const snapshot = baseWindowSnapshot();

    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, "win-a", snapshot);

    expect(nextSnapshot.session.openTabs).toHaveLength(2);
    expect(nextRegistry["/tmp/shared.txt"]).toEqual({ windowId: "win-a", documentId: "doc-1" });
  });
});
