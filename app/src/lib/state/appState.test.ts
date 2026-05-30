import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTab, createFileTab, isAgentTab, tabDocumentId } from "../domain/contracts";
import { appState, resetThemePersistenceForTests, setThemeSaveErrorNotifier } from "./appState";
import { saveThemeFile } from "../services/themeStore";

vi.mock("../services/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});

const saveThemeFileMock = vi.mocked(saveThemeFile);

describe("appState tabs and selection", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("createTab adds a document and selects it", () => {
    appState.createTab();
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(2);
    expect(snapshot.documents).toHaveLength(2);
    expect(snapshot.session.selectedTabId).toBe("tab-2");
  });

  it("selectTab ignores unknown tab ids", () => {
    appState.selectTab("tab-missing");
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-1");
  });

  it("openOrFocusAgentTab opens a new agent tab and focuses an existing one", () => {
    appState.openOrFocusAgentTab("agent-a");
    let snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(2);
    const firstAgentTab = snapshot.session.openTabs.find((tab) => isAgentTab(tab) && tab.agentId === "agent-a");
    expect(firstAgentTab?.id).toBe("tab-2");
    expect(snapshot.session.selectedTabId).toBe("tab-2");

    appState.selectTab("tab-1");
    appState.openOrFocusAgentTab("agent-a");
    snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(2);
    expect(snapshot.session.selectedTabId).toBe("tab-2");
  });

  it("closeTabsForAgent removes all tabs for that agent", () => {
    appState.openOrFocusAgentTab("agent-a");
    appState.openOrFocusAgentTab("agent-b");
    appState.closeTabsForAgent("agent-a");

    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs.some((tab) => isAgentTab(tab) && tab.agentId === "agent-a")).toBe(false);
    expect(snapshot.session.openTabs.some((tab) => isAgentTab(tab) && tab.agentId === "agent-b")).toBe(true);
  });

  it("closeTabForce focuses the next open agent tab in tab-bar order", () => {
    appState.openOrFocusAgentTab("agent-a");
    appState.openOrFocusAgentTab("agent-b");
    const agentATabId = appState
      .getSnapshot()
      .session.openTabs.find((tab) => isAgentTab(tab) && tab.agentId === "agent-a")?.id;
    expect(agentATabId).toBeDefined();
    appState.selectTab(agentATabId!);

    appState.closeTabForce(agentATabId!);

    const snapshot = appState.getSnapshot();
    const selected = snapshot.session.openTabs.find((tab) => tab.id === snapshot.session.selectedTabId);
    expect(selected && isAgentTab(selected) ? selected.agentId : null).toBe("agent-b");
  });

  it("persists lastActiveAgentId in session state", () => {
    appState.setLastActiveAgentId("agent-a");
    expect(appState.getSnapshot().session.lastActiveAgentId).toBe("agent-a");
    appState.setLastActiveAgentId(null);
    expect(appState.getSnapshot().session.lastActiveAgentId).toBeNull();
  });

  it("selectOrReopenTabForDocument selects an open tab", () => {
    appState.createTab();
    appState.selectTab("tab-1");
    appState.selectOrReopenTabForDocument("doc-2");
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-2");
  });

  it("selectOrReopenTabForDocument reopens a closed document in a new tab", () => {
    appState.openFileInTab("/tmp/notes.txt", "notes");
    const documentId = appState.findDocumentIdByPath("/tmp/notes.txt");
    expect(documentId).not.toBeNull();
    appState.closeTabForce("tab-2");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);

    appState.selectOrReopenTabForDocument(documentId!);
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(2);
    expect(snapshot.session.selectedTabId).toBe("tab-3");
  });

  it("closeTab cannot remove the last remaining tab", () => {
    appState.closeTab("tab-1");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);
  });

  it("closeTab removes a tab when more than one is open", () => {
    appState.createTab();
    appState.closeTab("tab-2");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-1");
  });

  it("closeTabForce creates a new untitled tab when the last tab closes", () => {
    appState.closeTabForce("tab-1");
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(1);
    expect(snapshot.documents[0]?.title).toBe("Untitled");
  });

  it("closeTabWithPrompt closes a non-selected dirty tab when confirmed", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.setDocumentContent("doc-2", "a dirty");
    const confirm = vi.fn(() => true);

    const closed = appState.closeTabWithPrompt("tab-2", confirm);

    expect(closed).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Close a.txt without saving?");
    expect(appState.getSnapshot().session.openTabs.some((tab) => tab.id === "tab-2")).toBe(false);
  });

  it("closeOtherTabs keeps context tab and skips pinned tabs", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");

    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      notepad: {
        ...appState.getWindowSessionSnapshot().notepad,
        session: {
          ...appState.getWindowSessionSnapshot().notepad.session,
          openTabs: [
            createFileTab("tab-1", "doc-1"),
            createFileTab("tab-2", "doc-2"),
            createFileTab("tab-3", "doc-3", true),
            createFileTab("tab-4", "doc-4"),
          ],
          selectedTabId: "tab-4",
        },
      },
    });

    const closed = appState.closeOtherTabs("tab-2", () => true);

    expect(closed).toBe(true);
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs.map((tab) => tab.id)).toEqual(["tab-2", "tab-3"]);
    expect(snapshot.session.selectedTabId).toBe("tab-2");
  });

  it("closeOtherTabs aborts when a dirty tab is rejected", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.setDocumentContent("doc-3", "dirty");
    const before = appState.getSnapshot().session.openTabs.map((tab) => tab.id);

    const closed = appState.closeOtherTabs("tab-2", () => false);

    expect(closed).toBe(false);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual(before);
  });

  it("closeTabsToRight closes only right-side unpinned tabs", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");
    appState.openFileInTab("/tmp/c.txt", "c");
    appState.openFileInTab("/tmp/d.txt", "d");

    appState.applyWindowSession({
      ...appState.getWindowSessionSnapshot(),
      notepad: {
        ...appState.getWindowSessionSnapshot().notepad,
        session: {
          ...appState.getWindowSessionSnapshot().notepad.session,
          openTabs: [
            createFileTab("tab-1", "doc-1"),
            createFileTab("tab-2", "doc-2"),
            createFileTab("tab-3", "doc-3"),
            createFileTab("tab-4", "doc-4", true),
            createFileTab("tab-5", "doc-5"),
          ],
          selectedTabId: "tab-3",
        },
      },
    });

    const closed = appState.closeTabsToRight("tab-2", () => true);

    expect(closed).toBe(true);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual([
      "tab-1",
      "tab-2",
      "tab-4",
    ]);
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-2");
  });

  it("closeMissingFileTabs closes missing tabs without prompt and keeps pinned missing", () => {
    appState.openFileInTab("/tmp/a.txt", "a");
    appState.openFileInTab("/tmp/b.txt", "b");

    const currentSnapshot = appState.getWindowSessionSnapshot();
    appState.applyWindowSession({
      ...currentSnapshot,
      notepad: {
        ...currentSnapshot.notepad,
        documents: currentSnapshot.notepad.documents.map((doc) =>
          doc.id === "doc-2" || doc.id === "doc-3"
            ? { ...doc, fileMissing: true }
            : doc,
        ),
        session: {
          ...currentSnapshot.notepad.session,
          openTabs: [
            createFileTab("tab-1", "doc-1"),
            createFileTab("tab-2", "doc-2"),
            createFileTab("tab-3", "doc-3", true),
          ],
          selectedTabId: "tab-2",
        },
      },
    });

    const closed = appState.closeMissingFileTabs();

    expect(closed).toBe(true);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual(["tab-1", "tab-3"]);
  });

  it("closeMissingFileTabs keeps one Untitled tab when all tabs close", () => {
    const currentSnapshot = appState.getWindowSessionSnapshot();
    appState.applyWindowSession({
      ...currentSnapshot,
      notepad: {
        ...currentSnapshot.notepad,
        documents: currentSnapshot.notepad.documents.map((doc) => ({ ...doc, fileMissing: true })),
      },
    });

    const closed = appState.closeMissingFileTabs();
    const snapshot = appState.getSnapshot();

    expect(closed).toBe(true);
    expect(snapshot.session.openTabs).toHaveLength(1);
    const selectedTab = snapshot.session.openTabs[0];
    expect(selectedTab).toBeDefined();
    expect(snapshot.documents.find((doc) => doc.id === tabDocumentId(selectedTab))?.title).toBe("Untitled");
  });

  it("reorderTabs moves tabs and ignores invalid indices", () => {
    appState.createTab();
    appState.reorderTabs(1, 0);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual([
      "tab-2",
      "tab-1",
    ]);

    appState.reorderTabs(-1, 0);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual([
      "tab-2",
      "tab-1",
    ]);
  });

  it("transferActiveTabOut and openTransferredTab round-trip tab payload", () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const transfer = appState.transferActiveTabOut();
    expect(transfer).toEqual({
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);

    const documentId = appState.openTransferredTab(transfer!);
    expect(documentId).toBe("doc-2");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(2);
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-3");
  });
});

describe("appState documents and paths", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("openFileInTab opens a new saved document", () => {
    appState.openFileInTab("/tmp/readme.md", "# Title");
    const snapshot = appState.getSnapshot();
    const document = snapshot.documents.find((doc) => doc.filePath === "/tmp/readme.md");
    expect(document?.content).toBe("# Title");
    expect(document?.language).toBe("markdown");
    expect(snapshot.recentFiles[0]).toBe("/tmp/readme.md");
  });

  it("openFileInTab selects an existing document for duplicate paths", () => {
    appState.openFileInTab("/tmp/dup.txt", "first");
    appState.openFileInTab("/tmp/other.txt", "other");
    appState.openFileInTab("/tmp/dup.txt", "second");
    const snapshot = appState.getSnapshot();
    expect(snapshot.documents.filter((doc) => doc.filePath === "/tmp/dup.txt")).toHaveLength(1);
    expect(snapshot.session.selectedTabId).toBe("tab-2");
    expect(snapshot.recentFiles[0]).toBe("/tmp/dup.txt");
  });

  it("findDocumentIdByPath returns null for untitled documents", () => {
    expect(appState.findDocumentIdByPath("/tmp/missing.txt")).toBeNull();
  });

  it("setDocumentContent marks documents dirty and detects CRLF", () => {
    appState.setDocumentContent("doc-1", "line\r\n");
    const document = appState.getSnapshot().documents[0];
    expect(document?.isDirty).toBe(true);
    expect(document?.lineEnding).toBe("crlf");
  });

  it("markDocumentSaved clears dirty state and updates metadata", () => {
    appState.setDocumentContent("doc-1", "draft");
    appState.markDocumentSaved("doc-1", "/tmp/saved.txt", "draft");
    const document = appState.getSnapshot().documents[0];
    expect(document?.isDirty).toBe(false);
    expect(document?.filePath).toBe("/tmp/saved.txt");
    expect(document?.title).toBe("saved.txt");
    expect(document?.language).toBe("plaintext");
    expect(document?.fileMissing).toBe(false);
  });

  it("refreshUntitledTitle derives title from first line", () => {
    appState.setDocumentContent("doc-1", "My Draft Title\nbody");
    appState.refreshUntitledTitle("doc-1");
    expect(appState.getSnapshot().documents[0]?.title).toBe("My Draft Title");
  });

  it("refreshUntitledTitle truncates long first lines to 64 characters", () => {
    const longLine = "x".repeat(80);
    appState.setDocumentContent("doc-1", longLine);
    appState.refreshUntitledTitle("doc-1");
    expect(appState.getSnapshot().documents[0]?.title).toHaveLength(64);
  });

  it("normalizeUntitledTitles leaves saved documents unchanged", () => {
    appState.openFileInTab("/tmp/saved.txt", "content");
    appState.normalizeUntitledTitles();
    expect(appState.getSnapshot().documents.find((doc) => doc.id === "doc-2")?.title).toBe(
      "saved.txt",
    );
  });

  it("caps recentFiles at 15 unique entries", () => {
    for (let index = 0; index < 16; index += 1) {
      appState.openFileInTab(`/tmp/file-${index}.txt`, "x");
    }
    expect(appState.getSnapshot().recentFiles).toHaveLength(15);
    expect(appState.getSnapshot().recentFiles[0]).toBe("/tmp/file-15.txt");
  });

  it("infers markdown for .markdown files on save", () => {
    appState.setDocumentContent("doc-1", "# hi");
    appState.markDocumentSaved("doc-1", "/tmp/readme.markdown", "# hi");
    expect(appState.getSnapshot().documents[0]?.language).toBe("markdown");
  });
});

describe("appState external file fields", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("applyDocumentDiskReload replaces buffer and clears dismissed/missing flags", () => {
    appState.openFileInTab("/tmp/external.txt", "old");
    appState.applyDocumentKeepLocal("doc-2", { mtimeMs: 1, sizeBytes: 1 });
    appState.setDocumentDiskState("doc-2", { diskFingerprint: null, fileMissing: true });

    appState.applyDocumentDiskReload("doc-2", "new", { mtimeMs: 2, sizeBytes: 2 });
    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document).toMatchObject({
      content: "new",
      savedContent: "new",
      isDirty: false,
      diskFingerprint: { mtimeMs: 2, sizeBytes: 2 },
      dismissedFingerprint: null,
      fileMissing: false,
    });
  });

  it("applyDocumentKeepLocal stores dismissed fingerprint only", () => {
    appState.openFileInTab("/tmp/keep.txt", "local");
    appState.setDocumentContent("doc-2", "edited");
    appState.applyDocumentKeepLocal("doc-2", { mtimeMs: 9, sizeBytes: 9 });

    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document?.dismissedFingerprint).toEqual({ mtimeMs: 9, sizeBytes: 9 });
    expect(document?.content).toBe("edited");
    expect(document?.isDirty).toBe(true);
  });

  it("setDocumentDiskState updates fingerprint and missing flag", () => {
    appState.openFileInTab("/tmp/missing.txt", "content");
    appState.setDocumentDiskState("doc-2", {
      diskFingerprint: { mtimeMs: 3, sizeBytes: 3 },
      fileMissing: true,
    });
    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document?.diskFingerprint).toEqual({ mtimeMs: 3, sizeBytes: 3 });
    expect(document?.fileMissing).toBe(true);
  });

  it("setDocumentMarkdownViewMode stores per-document markdown view mode", () => {
    appState.openFileInTab("/tmp/readme.md", "# Hello");
    appState.setDocumentMarkdownViewMode("doc-2", "preview");
    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document?.markdownViewMode).toBe("preview");
  });
});

describe("appState settings and editor chrome", () => {
  beforeEach(() => {
    appState.resetAppState();
    resetThemePersistenceForTests();
    saveThemeFileMock.mockClear();
  });

  it("setActiveTheme updates the active built-in theme", () => {
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    expect(saveThemeFileMock).toHaveBeenCalled();
  });

  it("cycleTheme toggles between the two built-in themes", () => {
    expect(appState.getSnapshot().theme.activeTheme.id).toBe("dark-amber");
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("cycleTheme from active custom switches to opposite built-in", () => {
    appState.createCustomTheme();
    expect(appState.getSnapshot().theme.activeTheme.kind).toBe("custom");
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
    appState.createCustomTheme();
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    appState.createCustomTheme();
    appState.cycleTheme();
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("createCustomTheme adds a custom theme and selects it", () => {
    appState.createCustomTheme();
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.activeTheme.kind).toBe("custom");
    expect(snapshot.theme.customThemes).toHaveLength(1);
    expect(snapshot.theme.customThemes[0]?.name).toBe("Custom 1");
    expect(saveThemeFileMock).toHaveBeenCalled();
  });

  it("renameCustomTheme trims and persists the new name", () => {
    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    appState.renameCustomTheme(customId, "  My Theme  ");
    expect(appState.getSnapshot().theme.customThemes[0]?.name).toBe("My Theme");
    appState.renameCustomTheme(customId, "   ");
    expect(appState.getSnapshot().theme.customThemes[0]?.name).toBe("My Theme");
  });

  it("deleteCustomTheme falls back to dark-amber when active custom is deleted", () => {
    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    appState.deleteCustomTheme(customId);
    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.customThemes).toHaveLength(0);
    expect(snapshot.theme.activeTheme).toEqual({
      kind: "builtin",
      id: "dark-amber",
    });
  });

  it("updateCustomThemeToken debounces save and keeps in-memory state on write failure", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    setThemeSaveErrorNotifier(notify);
    saveThemeFileMock.mockRejectedValueOnce(new Error("disk full"));

    appState.createCustomTheme();
    const customId = appState.getSnapshot().theme.customThemes[0]!.id;
    saveThemeFileMock.mockClear();

    appState.updateCustomThemeToken(customId, "accent-color", "#112233");
    expect(appState.getSnapshot().theme.customThemes[0]?.tokens["accent-color"]).toBe("#112233");

    await vi.advanceTimersByTimeAsync(300);
    expect(notify).toHaveBeenCalledWith(
      "Failed to save theme. Changes kept in memory; will retry on next change.",
    );
    expect(appState.getSnapshot().theme.customThemes[0]?.tokens["accent-color"]).toBe("#112233");

    saveThemeFileMock.mockResolvedValueOnce(undefined);
    appState.updateCustomThemeToken(customId, "accent-color", "#445566");
    await vi.advanceTimersByTimeAsync(300);
    expect(saveThemeFileMock).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("applyPersistedSettings updates only provided fields", () => {
    appState.applyPersistedSettings({ zoomPercent: 130, wrapLines: false });
    const snapshot = appState.getSnapshot();
    expect(snapshot.editor.zoomPercent).toBe(130);
    expect(snapshot.editor.wrapLines).toBe(false);
    expect(snapshot.theme.activeTheme.id).toBe("dark-amber");
  });

  it("applyWindowSession preserves the active theme", () => {
    appState.setActiveTheme({ kind: "builtin", id: "light-blue" });
    appState.applyWindowSession({
      activeContextId: "notepad",
      notepad: {
        documents: [
          {
            id: "doc-1",
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
            markdownViewMode: "edit",
          },
        ],
        session: {
          selectedTabId: "tab-1",
          openTabs: [createFileTab("tab-1", "doc-1")],
          lastActiveWindowId: "main",
          windowBounds: null,
        },
      },
      workspaces: [],
      editorPreferences: {
        zoomPercent: 100,
        wrapLines: true,
        projectPanelCollapsed: false,
      },
    });
    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
  });

  it("setPreviewMode, zoom, and wrap update editor state", () => {
    appState.setPreviewMode("diff");
    appState.setZoomPercent(110);
    appState.toggleWrap();
    appState.setProjectPanelCollapsed(true);

    const editor = appState.getSnapshot().editor;
    expect(editor.previewMode).toBe("diff");
    expect(editor.zoomPercent).toBe(110);
    expect(editor.wrapLines).toBe(false);
    expect(editor.projectPanelCollapsed).toBe(true);
  });
});

describe("appState session restore", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("restores active workspace context, order, tabs, and project panel state", () => {
    appState.applyWindowSession(
      {
        activeContextId: "ws-2",
        notepad: {
          documents: [
            {
              id: "doc-1",
              filePath: "/tmp/notepad.md",
              title: "notepad.md",
              content: "notepad",
              savedContent: "notepad",
              isDirty: false,
              language: "markdown",
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
            lastActiveWindowId: "main",
            windowBounds: null,
          },
        },
        workspaces: [
          {
            id: "ws-1",
            rootPath: "/tmp/ws-one",
            snapshot: {
              documents: [
                {
                  id: "doc-2",
                  filePath: "/tmp/ws-one/a.ts",
                  title: "a.ts",
                  content: "export const a = 1;",
                  savedContent: "export const a = 1;",
                  isDirty: false,
                  language: "typescript",
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
                selectedTabId: "tab-2",
                openTabs: [createFileTab("tab-2", "doc-2")],
                lastActiveWindowId: "main",
                windowBounds: null,
              },
            },
          },
          {
            id: "ws-2",
            rootPath: "/tmp/ws-two",
            snapshot: {
              documents: [
                {
                  id: "doc-3",
                  filePath: "/tmp/ws-two/b.ts",
                  title: "b.ts",
                  content: "export const b = 2;",
                  savedContent: "export const b = 2;",
                  isDirty: false,
                  language: "typescript",
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
                selectedTabId: "tab-3",
                openTabs: [createFileTab("tab-3", "doc-3")],
                lastActiveWindowId: "main",
                windowBounds: null,
              },
            },
          },
        ],
        editorPreferences: {
          zoomPercent: 120,
          wrapLines: false,
          projectPanelCollapsed: true,
        },
      },
      ["/tmp/notepad.md"],
    );

    const snapshot = appState.getSnapshot();
    expect(snapshot.contexts.activeContextId).toBe("ws-2");
    expect(snapshot.contexts.workspaces.map((workspace) => workspace.id)).toEqual(["ws-1", "ws-2"]);
    expect(snapshot.session.selectedTabId).toBe("tab-3");
    expect(snapshot.documents[0]?.filePath).toBe("/tmp/ws-two/b.ts");
    expect(snapshot.editor.projectPanelCollapsed).toBe(true);
  });
});
