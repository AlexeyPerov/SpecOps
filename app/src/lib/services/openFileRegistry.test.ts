import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppDomainState,
  AppSessionSnapshot,
  OpenFileRegistry,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { createFileTab } from "../domain/contracts";
import { createSessionFsMock } from "../test/sessionMock";
import { defaultAppProviderSettings } from "../ai/providers/appProviderSettings";
import { defaultProviderModelCatalogs } from "../ai/providers/providerModelCatalog";
import { defaultSettings } from "../state/appState/settingsSlice";
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
  const notepad: WindowSessionSnapshot["notepad"] = {
    documents: [
      {
        id: "doc-1",
        filePath: "/tmp/shared.txt",
        title: "shared.txt",
        content: "content",
        savedContent: "content",
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
      {
        id: "doc-2",
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
      selectedTabId: "tab-1",
      openTabs: [
        createFileTab("tab-1", "doc-1"),
        createFileTab("tab-2", "doc-2"),
      ],
      lastActiveWindowId: "win-a",
      windowBounds: null,
    },
  };
  return {
    activeContextId: "notepad",
    notepad,
    chatHttp: notepad,
    workspaces: [],
    editorPreferences: {
      zoomPercent: 100,
      wrapLines: true,
    },
    ...overrides,
  };
}

function emptySession(): AppSessionSnapshot {
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    lastActiveWindowId: "main",
    openFileRegistry: {},
    recentFiles: [],
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
      contexts: {
        activeContextId: "notepad",
        notepad: {
          documents: [
            {
              id: "doc-1",
              filePath: "/tmp/new.txt",
              title: "new.txt",
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
            selectedTabId: "tab-1",
            openTabs: [createFileTab("tab-1", "doc-1")],
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        chatHttp: {
          documents: [],
          session: {
            selectedTabId: null,
            openTabs: [],
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        workspaces: [],
      },
      settings: {
        ...defaultSettings,
        decoratePlaintextSymbols: false,
      },
      theme: {
        mode: "auto",
        darkTheme: { kind: "builtin", id: "dark-amber" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        manualTheme: { kind: "builtin", id: "dark-amber" },
        customThemes: [],
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
      activityRailWidthPx: 48,
    };

    await syncOpenFileRegistryForWindow("win-a", state);

    expect(sessionMock.getSessionStore()?.openFileRegistry).toEqual({
      "/tmp/other-window.txt": { windowId: "win-b", documentId: "doc-x" },
      "/tmp/new.txt": { windowId: "win-a", documentId: "doc-1" },
    });
  });

  it("collects saved tabs across notepad and workspace contexts", async () => {
    const state: AppDomainState = {
      contexts: {
        activeContextId: "ws-1",
        notepad: {
          documents: [
            {
              id: "doc-n",
              filePath: "/tmp/notepad.txt",
              title: "notepad.txt",
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
            selectedTabId: "tab-n",
            openTabs: [createFileTab("tab-n", "doc-n")],
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        chatHttp: {
          documents: [],
          session: {
            selectedTabId: null,
            openTabs: [],
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        workspaces: [
          {
            id: "ws-1",
            rootPath: "/tmp/ws",
            snapshot: {
              documents: [
                {
                  id: "doc-w",
                  filePath: "/tmp/ws/workspace.txt",
                  title: "workspace.txt",
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
                selectedTabId: "tab-w",
                openTabs: [createFileTab("tab-w", "doc-w")],
                lastActiveWindowId: "win-a",
                windowBounds: null,
              },
            },
          },
        ],
      },
      settings: {
        ...defaultSettings,
        decoratePlaintextSymbols: false,
      },
      theme: {
        mode: "auto",
        darkTheme: { kind: "builtin", id: "dark-amber" },
        lightTheme: { kind: "builtin", id: "light-blue" },
        manualTheme: { kind: "builtin", id: "dark-amber" },
        customThemes: [],
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
      activityRailWidthPx: 48,
    };

    await syncOpenFileRegistryForWindow("win-a", state);

    expect(sessionMock.getSessionStore()?.openFileRegistry).toMatchObject({
      "/tmp/notepad.txt": { windowId: "win-a", documentId: "doc-n" },
      "/tmp/ws/workspace.txt": { windowId: "win-a", documentId: "doc-w" },
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

    expect(nextSnapshot.notepad.session.openTabs.map((tab) => tab.id)).toEqual(["tab-2"]);
    expect(nextSnapshot.notepad.session.selectedTabId).toBe("tab-2");
    expect(nextSnapshot.notepad.documents.map((doc) => doc.id)).toEqual(["doc-2"]);
    expect(nextRegistry["/tmp/shared.txt"]).toEqual({ windowId: "win-b", documentId: "doc-9" });
  });

  it("keeps untitled tabs and claims saved tabs for the restoring window", () => {
    const registry: OpenFileRegistry = {};
    const snapshot = baseWindowSnapshot();

    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, "win-a", snapshot);

    expect(nextSnapshot.notepad.session.openTabs).toHaveLength(2);
    expect(nextRegistry["/tmp/shared.txt"]).toEqual({ windowId: "win-a", documentId: "doc-1" });
  });
});
