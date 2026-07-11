import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppDomainState,
  AppSessionSnapshot,
  OpenFileRegistry,
  WindowSessionSnapshot,
} from "../domain/contracts";
import { createFileTab, createSinglePaneLayout, getSessionSelectedTabId, getSessionTabs } from "../domain/contracts";
import type { EditorLayout } from "../domain/contracts";
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
      editorLayout: createSinglePaneLayout(
        [createFileTab("tab-1", "doc-1"), createFileTab("tab-2", "doc-2")],
        "tab-1",
      ),
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
            editorLayout: createSinglePaneLayout([createFileTab("tab-1", "doc-1")], "tab-1"),
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        chatHttp: {
          documents: [],
          session: {
            editorLayout: createSinglePaneLayout([], null),
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
        selectionCount: 1,
        zoomPercent: 100,
        wrapLines: true,
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
            editorLayout: createSinglePaneLayout([createFileTab("tab-n", "doc-n")], "tab-n"),
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        chatHttp: {
          documents: [],
          session: {
            editorLayout: createSinglePaneLayout([], null),
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
                editorLayout: createSinglePaneLayout([createFileTab("tab-w", "doc-w")], "tab-w"),
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
        selectionCount: 1,
        zoomPercent: 100,
        wrapLines: true,
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

  it("registers file tabs from every pane in a split layout", async () => {
    const gridLayout: EditorLayout = {
      kind: "grid-2x2",
      panes: [
        { id: "pane-1", tabs: [createFileTab("tab-1", "doc-1")], selectedTabId: "tab-1" },
        { id: "pane-2", tabs: [createFileTab("tab-2", "doc-2")], selectedTabId: "tab-2" },
        { id: "pane-3", tabs: [createFileTab("tab-3", "doc-3")], selectedTabId: "tab-3" },
        { id: "pane-4", tabs: [createFileTab("tab-4", "doc-4")], selectedTabId: "tab-4" },
      ],
      slots: [[0, 1], [2, 3]],
      activePaneId: "pane-1",
    };
    const state: AppDomainState = {
      contexts: {
        activeContextId: "notepad",
        notepad: {
          documents: [
            {
              id: "doc-1",
              filePath: "/tmp/a.txt",
              title: "a.txt",
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
            {
              id: "doc-2",
              filePath: "/tmp/b.txt",
              title: "b.txt",
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
            {
              id: "doc-3",
              filePath: "/tmp/c.txt",
              title: "c.txt",
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
            {
              id: "doc-4",
              filePath: "/tmp/d.txt",
              title: "d.txt",
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
            editorLayout: gridLayout,
            lastActiveWindowId: "win-a",
            windowBounds: null,
          },
        },
        chatHttp: {
          documents: [],
          session: {
            editorLayout: createSinglePaneLayout([], null),
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
        selectionCount: 1,
        zoomPercent: 100,
        wrapLines: true,
        previewMode: "editor",
      },
      activityRailWidthPx: 48,
    };

    await syncOpenFileRegistryForWindow("win-a", state);

    expect(sessionMock.getSessionStore()?.openFileRegistry).toMatchObject({
      "/tmp/a.txt": { windowId: "win-a", documentId: "doc-1" },
      "/tmp/b.txt": { windowId: "win-a", documentId: "doc-2" },
      "/tmp/c.txt": { windowId: "win-a", documentId: "doc-3" },
      "/tmp/d.txt": { windowId: "win-a", documentId: "doc-4" },
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

    expect(getSessionTabs(nextSnapshot.notepad.session).map((tab) => tab.id)).toEqual(["tab-2"]);
    expect(getSessionSelectedTabId(nextSnapshot.notepad.session)).toBe("tab-2");
    expect(nextSnapshot.notepad.documents.map((doc) => doc.id)).toEqual(["doc-2"]);
    expect(nextRegistry["/tmp/shared.txt"]).toEqual({ windowId: "win-b", documentId: "doc-9" });
  });

  it("keeps untitled tabs and claims saved tabs for the restoring window", () => {
    const registry: OpenFileRegistry = {};
    const snapshot = baseWindowSnapshot();

    const { registry: nextRegistry, snapshot: nextSnapshot } =
      applyRegistryDedupeToWindowSnapshot(registry, "win-a", snapshot);

    expect(getSessionTabs(nextSnapshot.notepad.session)).toHaveLength(2);
    expect(nextRegistry["/tmp/shared.txt"]).toEqual({ windowId: "win-a", documentId: "doc-1" });
  });

  it("preserves tabs and documents in non-active panes during dedupe", () => {
    const gridLayout: EditorLayout = {
      kind: "grid-2x2",
      panes: [
        { id: "pane-1", tabs: [createFileTab("tab-1", "doc-1")], selectedTabId: "tab-1" },
        { id: "pane-2", tabs: [createFileTab("tab-2", "doc-2")], selectedTabId: "tab-2" },
        { id: "pane-3", tabs: [createFileTab("tab-3", "doc-3")], selectedTabId: "tab-3" },
        { id: "pane-4", tabs: [createFileTab("tab-4", "doc-4")], selectedTabId: "tab-4" },
      ],
      slots: [[0, 1], [2, 3]],
      activePaneId: "pane-1",
    };
    const snapshot = baseWindowSnapshot({
      notepad: {
        documents: [
          {
            id: "doc-1",
            filePath: "/tmp/a.txt",
            title: "a.txt",
            content: "a",
            savedContent: "a",
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
            filePath: "/tmp/b.txt",
            title: "b.txt",
            content: "b",
            savedContent: "b",
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
            id: "doc-3",
            filePath: "/tmp/c.txt",
            title: "c.txt",
            content: "c",
            savedContent: "c",
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
            id: "doc-4",
            filePath: "/tmp/d.txt",
            title: "d.txt",
            content: "d",
            savedContent: "d",
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
          editorLayout: gridLayout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });

    const { snapshot: nextSnapshot } = applyRegistryDedupeToWindowSnapshot({}, "win-a", snapshot);
    const restored = nextSnapshot.notepad.session.editorLayout;

    expect(restored.panes).toHaveLength(4);
    expect(restored.panes.map((pane) => pane.tabs.map((tab) => tab.id))).toEqual([
      ["tab-1"],
      ["tab-2"],
      ["tab-3"],
      ["tab-4"],
    ]);
    expect(nextSnapshot.notepad.documents.map((doc) => doc.id)).toEqual([
      "doc-1",
      "doc-2",
      "doc-3",
      "doc-4",
    ]);
  });

  it("drops a tab only in the pane that owns a path claimed by another window", () => {
    const gridLayout: EditorLayout = {
      kind: "cols-2",
      panes: [
        { id: "pane-1", tabs: [createFileTab("tab-1", "doc-1")], selectedTabId: "tab-1" },
        {
          id: "pane-2",
          tabs: [createFileTab("tab-2", "doc-2"), createFileTab("tab-3", "doc-3")],
          selectedTabId: "tab-2",
        },
      ],
      slots: [[0, 1]],
      activePaneId: "pane-1",
    };
    const snapshot = baseWindowSnapshot({
      notepad: {
        documents: [
          {
            id: "doc-1",
            filePath: "/tmp/a.txt",
            title: "a.txt",
            content: "a",
            savedContent: "a",
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
            filePath: "/tmp/shared.txt",
            title: "shared.txt",
            content: "shared",
            savedContent: "shared",
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
            id: "doc-3",
            filePath: "/tmp/c.txt",
            title: "c.txt",
            content: "c",
            savedContent: "c",
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
          editorLayout: gridLayout,
          lastActiveWindowId: "win-a",
          windowBounds: null,
        },
      },
    });
    const registry: OpenFileRegistry = {
      "/tmp/shared.txt": { windowId: "win-b", documentId: "doc-9" },
    };

    const { snapshot: nextSnapshot } = applyRegistryDedupeToWindowSnapshot(
      registry,
      "win-a",
      snapshot,
    );
    const restored = nextSnapshot.notepad.session.editorLayout;

    expect(restored.panes[0].tabs.map((tab) => tab.id)).toEqual(["tab-1"]);
    expect(restored.panes[1].tabs.map((tab) => tab.id)).toEqual(["tab-3"]);
    expect(restored.panes[1].selectedTabId).toBe("tab-3");
    expect(nextSnapshot.notepad.documents.map((doc) => doc.id)).toEqual(["doc-1", "doc-3"]);
  });
});
