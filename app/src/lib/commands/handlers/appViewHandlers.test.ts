import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiskFingerprint } from "../../domain/contracts";
import { getSessionSelectedTabId, getSessionTabs } from "../../domain/contracts";
import { appState } from "../../state/appState";
import { keyboardEvent } from "../../test/helpers";

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn() },
  MenuItem: { new: vi.fn() },
  PredefinedMenuItem: { new: vi.fn() },
  Submenu: { new: vi.fn() },
}));

vi.mock("../../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
  openFileDialog: vi.fn(),
  openFolderDialog: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
  renameFile: vi.fn(),
}));

vi.mock("../../services/openFileGate", () => ({
  requestOpenPath: vi.fn(),
  completeOpenPath: vi.fn(),
  completeLargePendingOpen: vi.fn(),
}));

vi.mock("../../services/openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn(),
}));

vi.mock("../../services/externalFileChanges", () => ({
  reloadActiveDocumentFromDisk: vi.fn(),
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/appMenu", () => ({
  takeQueuedOpenRecentPath: vi.fn(),
  initializeAppMenu: vi.fn(),
  refreshOpenRecentMenu: vi.fn(),
  shouldInitializeAppMenu: vi.fn(),
}));

vi.mock("../../services/openActivePath", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/openActivePath")>();
  return {
    ...actual,
    openActivePath: vi.fn(),
  };
});

vi.mock("../../services/documentRename", () => ({
  renameDocumentOnDisk: vi.fn(),
}));

vi.mock("../../services/folderOpenableFiles", () => ({
  collectOpenableFolderFiles: vi.fn(),
}));

vi.mock("../../services/openAllInFolder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/openAllInFolder")>();
  return {
    ...actual,
    openAllInFolder: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(),
}));

vi.mock("../../services/tabWindowTransfer", () => ({
  moveTabToNewWindow: vi.fn(),
}));

vi.mock("../../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

vi.mock("../../services/windowManager", () => ({
  createNewWindowWithTransfer: vi.fn(),
}));

vi.mock("../../services/closeTabFlow", () => ({
  closeTabWithUnsavedPrompt: vi.fn(),
}));

import { expandPlatformKeymaps } from "../commandBindings";
import {
  dispatchCommand,
  commandDefinitions,
  getActiveDocumentContent,
  getRegisteredCommandIds,
  isEditorGlobalCommand,
  keymapCommandForEvent,
  resetCommandBindingOverrides,
  setCommandBindingOverrides,
} from "../registry";
import {
  ensureWorkspaceReadAccess,
  openFileDialog,
  openFolderDialog,
  saveFile,
  saveFileAs,
} from "../../services/fileSystem";
import { renameOpenFileRegistry } from "../../services/openFileRegistry";
import { closeTabWithUnsavedPrompt } from "../../services/closeTabFlow";
import { completeOpenPath, requestOpenPath } from "../../services/openFileGate";
import { reloadActiveDocumentFromDisk } from "../../services/externalFileChanges";
import { createNewWindowWithTransfer } from "../../services/windowManager";
import { takeQueuedOpenRecentPath } from "../../services/appMenu";
import { openActivePath } from "../../services/openActivePath";
import { renameDocumentOnDisk } from "../../services/documentRename";
import { collectOpenableFolderFiles } from "../../services/folderOpenableFiles";
import { openAllInFolder } from "../../services/openAllInFolder";
import { dirname } from "@tauri-apps/api/path";
import { moveTabToNewWindow } from "../../services/tabWindowTransfer";
import type { EditorCommandRunner } from "../../types/editor";

const closeTabWithUnsavedPromptMock = vi.mocked(closeTabWithUnsavedPrompt);
const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);
const reloadActiveDocumentFromDiskMock = vi.mocked(reloadActiveDocumentFromDisk);
const createNewWindowWithTransferMock = vi.mocked(createNewWindowWithTransfer);
const takeQueuedOpenRecentPathMock = vi.mocked(takeQueuedOpenRecentPath);
const openActivePathMock = vi.mocked(openActivePath);
const renameDocumentOnDiskMock = vi.mocked(renameDocumentOnDisk);
const collectOpenableFolderFilesMock = vi.mocked(collectOpenableFolderFiles);
const openAllInFolderMock = vi.mocked(openAllInFolder);
const dirnameMock = vi.mocked(dirname);
const moveTabToNewWindowMock = vi.mocked(moveTabToNewWindow);

const savedFingerprint: DiskFingerprint = { mtimeMs: 1, sizeBytes: 5 };

function keyboardEventFromBinding(binding: string, platform: "mac" | "windows"): KeyboardEvent {
  const parts = binding.split("+");
  const keyToken = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1);

  let metaKey = false;
  let ctrlKey = false;
  let shiftKey = false;
  let altKey = false;

  for (const modifier of modifiers) {
    if (modifier === "Cmd") {
      metaKey = platform === "mac";
    } else if (modifier === "Ctrl") {
      ctrlKey = platform === "windows";
    } else if (modifier === "Shift") {
      shiftKey = true;
    } else if (modifier === "Alt") {
      altKey = true;
    }
  }

  const keyByToken: Record<string, string> = {
    Up: "ArrowUp",
    Down: "ArrowDown",
    Tab: "Tab",
  };
  const key = keyByToken[keyToken] ?? keyToken;

  return keyboardEvent({ key, metaKey, ctrlKey, shiftKey, altKey });
}

function createEditorRunnerMock(): EditorCommandRunner {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    indent: vi.fn(),
    outdent: vi.fn(),
    moveLineUp: vi.fn(),
    moveLineDown: vi.fn(),
    duplicateLine: vi.fn(),
    joinLines: vi.fn(),
    setWrap: vi.fn(),
    setZoom: vi.fn(),
    findNext: vi.fn(() => false),
    findPrevious: vi.fn(() => false),
    replaceCurrent: vi.fn(() => false),
    replaceAndFindNext: vi.fn(() => false),
    replaceAll: vi.fn(() => 0),
    setSearchQuery: vi.fn(),
    getMatchInfo: vi.fn(() => ({ total: 0, current: 0 })),
    goToLine: vi.fn(() => false),
  };
}

function createCommandContext(overrides?: {
  confirm?: (message: string) => Promise<boolean>;
  editorRunner?: EditorCommandRunner | null;
  openProjectSearch?: (focusReplace: boolean) => void;
}) {
  const notify = vi.fn();
  const editorRunner = overrides?.editorRunner ?? null;
  const openProjectSearch = overrides?.openProjectSearch ?? vi.fn();
  return {
    context: {
      notify,
      getState: () => appState.getSnapshot(),
      getWindowId: () => "main",
      confirm: vi.fn(overrides?.confirm ?? (() => Promise.resolve(true))),
      getEditorRunner: vi.fn(() => editorRunner),
      openProjectSearch,
    },
    notify,
    editorRunner,
    openProjectSearch,
  };
}

async function flushCommandQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("view.toggleMarkdownPreview command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("cycles the active markdown document between edit and preview", () => {
    const { context, notify } = createCommandContext();
    appState.openFileInTab("/tmp/readme.md", "# Hello");
    // Markdown files default to preview (see settings.defaultMarkdownViewMode);
    // pin to edit here so the toggle cycle under test is deterministic.
    appState.setDocumentMarkdownViewMode("doc-2", "edit");

    dispatchCommand("view.toggleMarkdownPreview", context);
    expect(
      appState.getActiveDocuments().find((doc) => doc.id === "doc-2")?.markdownViewMode,
    ).toBe("preview");
    expect(notify).toHaveBeenCalledWith("Markdown preview on.");

    dispatchCommand("view.toggleMarkdownPreview", context);
    expect(
      appState.getActiveDocuments().find((doc) => doc.id === "doc-2")?.markdownViewMode,
    ).toBe("edit");
    expect(notify).toHaveBeenCalledWith("Markdown preview off.");
  });

  it("no-ops with a status message for non-markdown files", () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/plain.txt", "hello");

    dispatchCommand("view.toggleMarkdownPreview", context);

    expect(notify).toHaveBeenCalledWith("Markdown preview is only available for markdown files.");
    expect(appState.getActiveDocuments()[0]?.markdownViewMode).toBe("edit");
  });
});

describe("view.toggleDiffPreview command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("toggles global diff preview mode", () => {
    const { context, notify } = createCommandContext();

    dispatchCommand("view.toggleDiffPreview", context);
    expect(appState.getSnapshot().editor.previewMode).toBe("diff");
    expect(notify).toHaveBeenCalledWith("Diff preview on.");

    dispatchCommand("view.toggleDiffPreview", context);
    expect(appState.getSnapshot().editor.previewMode).toBe("editor");
    expect(notify).toHaveBeenCalledWith("Diff preview off.");
  });
});

describe("app shell toggle commands", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("app.toggleThemePane opens a themes view tab", () => {
    const { context } = createCommandContext();

    dispatchCommand("app.toggleThemePane", context);

    const tabs = getSessionTabs(appState.getActiveSession());
    expect(tabs.some((tab) => tab.kind === "view" && tab.view === "themes")).toBe(true);
  });

  it("app.toggleSettings opens a settings view tab", () => {
    const { context } = createCommandContext();

    dispatchCommand("app.toggleSettings", context);

    const tabs = getSessionTabs(appState.getActiveSession());
    expect(tabs.some((tab) => tab.kind === "view" && tab.view === "settings")).toBe(true);
  });

  it("app.toggleSettings focuses the existing settings tab instead of duplicating", () => {
    const { context } = createCommandContext();

    dispatchCommand("app.toggleSettings", context);
    dispatchCommand("app.toggleSettings", context);

    const settingsTabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => tab.kind === "view" && tab.view === "settings",
    );
    expect(settingsTabs).toHaveLength(1);
  });

  it("app.openWorkspaceManager switches to notepad and opens a singleton manager tab", () => {
    const { context } = createCommandContext();

    dispatchCommand("app.openWorkspaceManager", context);

    expect(appState.getActiveContext().id).toBe("notepad");
    const tabs = getSessionTabs(appState.getActiveSession());
    expect(tabs.some((tab) => tab.kind === "view" && tab.view === "workspace-manager")).toBe(true);
  });

  it("app.openWorkspaceManager focuses the existing manager tab instead of duplicating", () => {
    const { context } = createCommandContext();

    dispatchCommand("app.openWorkspaceManager", context);
    dispatchCommand("app.openWorkspaceManager", context);

    const managerTabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => tab.kind === "view" && tab.view === "workspace-manager",
    );
    expect(managerTabs).toHaveLength(1);
  });

  it("app.openVersionControl opens version-control for the active workspace", () => {
    const { context } = createCommandContext();
    const workspaceId = appState.addWorkspace("/tmp/ws-vc-cmd");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);

    dispatchCommand("app.openVersionControl", context);

    expect(appState.getActiveContext().id).toBe(workspaceId);
    const tabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => tab.kind === "view" && tab.view === "version-control",
    );
    expect(tabs).toHaveLength(1);
  });

  it("app.openVersionControl notifies on notepad without opening a tab", () => {
    const { context, notify } = createCommandContext();

    dispatchCommand("app.openVersionControl", context);

    expect(notify).toHaveBeenCalledWith("Open a workspace to use Version Control.");
    const tabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => tab.kind === "view" && tab.view === "version-control",
    );
    expect(tabs).toHaveLength(0);
  });

  it("app.openVersionControl notifies when git integration is disabled", () => {
    const { context, notify } = createCommandContext();
    const workspaceId = appState.addWorkspace("/tmp/ws-vc-git-off");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.setGitIntegrationEnabled(false);

    dispatchCommand("app.openVersionControl", context);

    expect(notify).toHaveBeenCalledWith(
      "Git integration is disabled in Settings. Enable it under Settings → Version Control.",
    );
    const tabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => tab.kind === "view" && tab.view === "version-control",
    );
    expect(tabs).toHaveLength(0);
  });

  it("app.openVersionControl focuses the existing tab instead of duplicating", () => {
    const { context } = createCommandContext();
    const workspaceId = appState.addWorkspace("/tmp/ws-vc-singleton");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);

    dispatchCommand("app.openVersionControl", context);
    dispatchCommand("app.openVersionControl", context);

    const versionControlTabs = getSessionTabs(appState.getActiveSession()).filter(
      (tab) => tab.kind === "view" && tab.view === "version-control",
    );
    expect(versionControlTabs).toHaveLength(1);
  });

  it("app.newWindow notifies on success and failure", async () => {
    const { context, notify } = createCommandContext();
    createNewWindowWithTransferMock.mockResolvedValueOnce("win-2");

    dispatchCommand("app.newWindow", context);
    await flushCommandQueue();

    expect(notify).toHaveBeenCalledWith("Opened new window.");

    createNewWindowWithTransferMock.mockResolvedValueOnce(null);
    dispatchCommand("app.newWindow", context);
    await flushCommandQueue();

    expect(notify).toHaveBeenCalledWith("Failed to open new window.");
  });

  it("view.cycleTheme advances to the next theme and switches to manual mode", () => {
    const { context } = createCommandContext();
    appState.setThemeMode("manual");
    appState.setManualTheme({ kind: "builtin", id: "dark-amber" });

    dispatchCommand("view.cycleTheme", context);

    const snapshot = appState.getSnapshot();
    expect(snapshot.theme.mode).toBe("manual");
    // dark-amber is builtin index 0; the next theme is light-blue (builtin index 1).
    expect(snapshot.theme.manualTheme).toEqual({ kind: "builtin", id: "light-blue" });
  });

  it("app.toggleFindReplace toggles find/replace panel state", () => {
    const { context } = createCommandContext();
    expect(appState.getSnapshot().editor.findReplaceOpen).toBe(false);

    dispatchCommand("app.toggleFindReplace", context);
    expect(appState.getSnapshot().editor.findReplaceOpen).toBe(true);

    dispatchCommand("app.toggleFindReplace", context);
    expect(appState.getSnapshot().editor.findReplaceOpen).toBe(false);
  });

  it("app.toggleGoTo toggles go-to panel state", () => {
    const { context } = createCommandContext();
    expect(appState.getSnapshot().editor.goToOpen).toBe(false);

    dispatchCommand("app.toggleGoTo", context);
    expect(appState.getSnapshot().editor.goToOpen).toBe(true);
  });

  it("app.findInProject opens the project search panel focused on find", () => {
    const openProjectSearch = vi.fn();
    const { context } = createCommandContext({ openProjectSearch });

    dispatchCommand("app.findInProject", context);

    expect(openProjectSearch).toHaveBeenCalledWith(false);
  });

  it("app.replaceInProject opens the project search panel focused on replace", () => {
    const openProjectSearch = vi.fn();
    const { context } = createCommandContext({ openProjectSearch });

    dispatchCommand("app.replaceInProject", context);

    expect(openProjectSearch).toHaveBeenCalledWith(true);
  });
});

describe("tab navigation commands", () => {
  beforeEach(() => {
    appState.resetAppState();
    moveTabToNewWindowMock.mockReset();
  });

  it("tab.next selects the next tab", () => {
    const { context } = createCommandContext();
    appState.createTab();
    appState.selectTab("tab-1");

    dispatchCommand("tab.next", context);

    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe("tab-2");
  });

  it("tab.previous selects the previous tab", () => {
    const { context } = createCommandContext();
    appState.createTab();
    const tabs = getSessionTabs(appState.getActiveSession());
    appState.selectTab(tabs[1]!.id);

    dispatchCommand("tab.previous", context);

    expect(getSessionSelectedTabId(appState.getActiveSession())).toBe(tabs[0]?.id);
  });

  it("tab.moveToNewWindow transfers the active tab", async () => {
    const { context, notify } = createCommandContext();
    moveTabToNewWindowMock.mockResolvedValue(true);

    dispatchCommand("tab.moveToNewWindow", context);
    await flushCommandQueue();

    expect(moveTabToNewWindowMock).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Transferred tab to new window.");
  });

  it("tab.moveToNewWindow does not notify success when transfer fails", async () => {
    const { context, notify } = createCommandContext();
    moveTabToNewWindowMock.mockResolvedValue(false);

    dispatchCommand("tab.moveToNewWindow", context);
    await flushCommandQueue();

    expect(moveTabToNewWindowMock).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith("Transferred tab to new window.");
  });
});

describe("edit commands", () => {
  it("delegates editor mutations to the active runner", () => {
    const editorRunner = createEditorRunnerMock();
    const { context } = createCommandContext({ editorRunner });

    dispatchCommand("edit.undo", context);
    dispatchCommand("edit.redo", context);
    dispatchCommand("edit.indent", context);
    dispatchCommand("edit.outdent", context);
    dispatchCommand("edit.moveLineUp", context);
    dispatchCommand("edit.moveLineDown", context);
    dispatchCommand("edit.duplicateLine", context);
    dispatchCommand("edit.joinLines", context);

    expect(editorRunner.undo).toHaveBeenCalled();
    expect(editorRunner.redo).toHaveBeenCalled();
    expect(editorRunner.indent).toHaveBeenCalled();
    expect(editorRunner.outdent).toHaveBeenCalled();
    expect(editorRunner.moveLineUp).toHaveBeenCalled();
    expect(editorRunner.moveLineDown).toHaveBeenCalled();
    expect(editorRunner.duplicateLine).toHaveBeenCalled();
    expect(editorRunner.joinLines).toHaveBeenCalled();
  });

  it("no-ops when no editor runner is available", () => {
    const { context } = createCommandContext({ editorRunner: null });

    expect(() => {
      dispatchCommand("edit.undo", context);
      dispatchCommand("edit.joinLines", context);
    }).not.toThrow();
  });
});

describe("view editor chrome commands", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("view.toggleWrap updates state and notifies", () => {
    const editorRunner = createEditorRunnerMock();
    const { context, notify } = createCommandContext({ editorRunner });
    expect(appState.getSnapshot().editor.wrapLines).toBe(true);

    dispatchCommand("view.toggleWrap", context);

    expect(appState.getSnapshot().editor.wrapLines).toBe(false);
    expect(editorRunner.setWrap).toHaveBeenCalledWith(false);
    expect(notify).toHaveBeenCalledWith("Wrap disabled.");
  });

  it("view.zoomIn increases zoom up to the cap", () => {
    const editorRunner = createEditorRunnerMock();
    const { context } = createCommandContext({ editorRunner });
    appState.setZoomPercent(210);

    dispatchCommand("view.zoomIn", context);

    expect(appState.getSnapshot().editor.zoomPercent).toBe(220);
    expect(editorRunner.setZoom).toHaveBeenCalledWith(220);
  });

  it("view.zoomOut decreases zoom down to the floor", () => {
    const editorRunner = createEditorRunnerMock();
    const { context } = createCommandContext({ editorRunner });
    appState.setZoomPercent(65);

    dispatchCommand("view.zoomOut", context);

    expect(appState.getSnapshot().editor.zoomPercent).toBe(60);
    expect(editorRunner.setZoom).toHaveBeenCalledWith(60);
  });

  it("view.zoomReset restores the default zoom", () => {
    const editorRunner = createEditorRunnerMock();
    const { context } = createCommandContext({ editorRunner });
    appState.setZoomPercent(150);

    dispatchCommand("view.zoomReset", context);

    expect(appState.getSnapshot().editor.zoomPercent).toBe(100);
    expect(editorRunner.setZoom).toHaveBeenCalledWith(100);
  });
});

describe("view layout commands", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("view.layoutGrid switches to a 2x2 grid", () => {
    const { context } = createCommandContext();
    dispatchCommand("view.layoutGrid", context);
    const layout = appState.getActiveSession().editorLayout;
    expect(layout.kind).toBe("grid-2x2");
    expect(layout.panes).toHaveLength(4);
  });

  it("view.layoutCols2 switches to two columns", () => {
    const { context } = createCommandContext();
    dispatchCommand("view.layoutCols2", context);
    expect(appState.getActiveSession().editorLayout.slots).toEqual([[0, 1]]);
  });

  it("view.layoutRows2 switches to two rows", () => {
    const { context } = createCommandContext();
    dispatchCommand("view.layoutRows2", context);
    expect(appState.getActiveSession().editorLayout.slots).toEqual([[0], [1]]);
  });

  it("view.layoutRows3 switches to three rows", () => {
    const { context } = createCommandContext();
    dispatchCommand("view.layoutRows3", context);
    expect(appState.getActiveSession().editorLayout.slots).toEqual([[0], [1], [2]]);
  });

  it("view.layoutSingle collapses back to a single pane", () => {
    const { context } = createCommandContext();
    dispatchCommand("view.layoutGrid", context);
    dispatchCommand("view.layoutSingle", context);
    const layout = appState.getActiveSession().editorLayout;
    expect(layout.kind).toBe("single");
    expect(layout.panes).toHaveLength(1);
  });

  it("view.focusPane1..4 focus the slot-ordered panes", () => {
    const { context } = createCommandContext();
    dispatchCommand("view.layoutGrid", context);
    const panes = appState.getActiveSession().editorLayout.panes;

    dispatchCommand("view.focusPane1", context);
    expect(appState.getActiveSession().editorLayout.activePaneId).toBe(panes[0].id);
    dispatchCommand("view.focusPane2", context);
    expect(appState.getActiveSession().editorLayout.activePaneId).toBe(panes[1].id);
    dispatchCommand("view.focusPane3", context);
    expect(appState.getActiveSession().editorLayout.activePaneId).toBe(panes[2].id);
    dispatchCommand("view.focusPane4", context);
    expect(appState.getActiveSession().editorLayout.activePaneId).toBe(panes[3].id);
  });
});

describe("command dispatch coverage", () => {
  it("tracks at least one dispatch test per defined command", () => {
    const testedIds = new Set([
      "app.toggleThemePane",
      "app.toggleSettings",
      "app.openWorkspaceManager",
      "app.openVersionControl",
      "app.newWindow",
      "view.cycleTheme",
      "app.toggleFindReplace",
      "app.toggleGoTo",
      "app.findInProject",
      "app.replaceInProject",
      "view.toggleMarkdownPreview",
      "view.toggleDiffPreview",
      "file.new",
      "file.open",
      "file.openRecent",
      "file.clearRecentFiles",
      "file.openAllInFolder",
      "workspace.add",
      "workspace.close",
      "workspace.reorder",
      "file.save",
      "file.saveAs",
      "file.saveAll",
      "file.rename",
      "file.reloadFromDisk",
      "tab.close",
      "tab.moveToNewWindow",
      "tab.next",
      "tab.previous",
      "edit.undo",
      "edit.redo",
      "edit.indent",
      "edit.outdent",
      "edit.moveLineUp",
      "edit.moveLineDown",
      "edit.duplicateLine",
      "edit.joinLines",
      "view.toggleWrap",
      "view.zoomIn",
      "view.zoomOut",
      "view.zoomReset",
      "view.layoutSingle",
      "view.layoutCols2",
      "view.layoutRows2",
      "view.layoutRows3",
      "view.layoutGrid",
      "view.focusPane1",
      "view.focusPane2",
      "view.focusPane3",
      "view.focusPane4",
    ]);

    const missing = commandDefinitions
      .map((definition) => definition.id)
      .filter((id) => !testedIds.has(id));

    expect(missing).toEqual([]);
  });
});
