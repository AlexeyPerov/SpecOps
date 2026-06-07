import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiskFingerprint } from "../domain/contracts";
import { appState } from "../state/appState";
import { keyboardEvent } from "../test/helpers";

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn() },
  MenuItem: { new: vi.fn() },
  PredefinedMenuItem: { new: vi.fn() },
  Submenu: { new: vi.fn() },
}));

vi.mock("../services/fileSystem", () => ({
  ensureWorkspaceReadAccess: vi.fn(),
  openFileDialog: vi.fn(),
  openFolderDialog: vi.fn(),
  saveFile: vi.fn(),
  saveFileAs: vi.fn(),
  renameFile: vi.fn(),
}));

vi.mock("../services/openFileGate", () => ({
  requestOpenPath: vi.fn(),
  completeOpenPath: vi.fn(),
  completeLargePendingOpen: vi.fn(),
}));

vi.mock("../services/openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn(),
}));

vi.mock("../services/externalFileChanges", () => ({
  reloadActiveDocumentFromDisk: vi.fn(),
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/appMenu", () => ({
  takeQueuedOpenRecentPath: vi.fn(),
  initializeAppMenu: vi.fn(),
  refreshOpenRecentMenu: vi.fn(),
  shouldInitializeAppMenu: vi.fn(),
}));

vi.mock("../services/openActivePath", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/openActivePath")>();
  return {
    ...actual,
    openActivePath: vi.fn(),
  };
});

vi.mock("../services/documentRename", () => ({
  renameDocumentOnDisk: vi.fn(),
}));

vi.mock("../services/folderOpenableFiles", () => ({
  collectOpenableFolderFiles: vi.fn(),
}));

vi.mock("../services/openAllInFolder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/openAllInFolder")>();
  return {
    ...actual,
    openAllInFolder: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(),
}));

vi.mock("../services/tabWindowTransfer", () => ({
  moveTabToNewWindow: vi.fn(),
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

vi.mock("../services/windowManager", () => ({
  createNewWindowWithTransfer: vi.fn(),
}));

vi.mock("../services/closeTabFlow", () => ({
  closeTabWithUnsavedPrompt: vi.fn(),
}));

import { expandPlatformKeymaps } from "./commandBindings";
import {
  dispatchCommand,
  commandDefinitions,
  getActiveDocumentContent,
  getRegisteredCommandIds,
  isEditorGlobalCommand,
  keymapCommandForEvent,
  resetCommandBindingOverrides,
  setCommandBindingOverrides,
} from "./registry";
import {
  ensureWorkspaceReadAccess,
  openFileDialog,
  openFolderDialog,
  saveFile,
  saveFileAs,
} from "../services/fileSystem";
import { renameOpenFileRegistry } from "../services/openFileRegistry";
import { closeTabWithUnsavedPrompt } from "../services/closeTabFlow";
import { completeOpenPath, requestOpenPath } from "../services/openFileGate";
import { reloadActiveDocumentFromDisk } from "../services/externalFileChanges";
import { createNewWindowWithTransfer } from "../services/windowManager";
import { takeQueuedOpenRecentPath } from "../services/appMenu";
import { openActivePath } from "../services/openActivePath";
import { renameDocumentOnDisk } from "../services/documentRename";
import { collectOpenableFolderFiles } from "../services/folderOpenableFiles";
import { openAllInFolder } from "../services/openAllInFolder";
import { dirname } from "@tauri-apps/api/path";
import { moveTabToNewWindow } from "../services/tabWindowTransfer";
import type { EditorCommandRunner } from "../types/editor";

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
  confirm?: (message: string) => boolean;
  editorRunner?: EditorCommandRunner | null;
  isThemePaneOpen?: boolean;
  isSettingsDialogOpen?: boolean;
}) {
  const notify = vi.fn();
  const setThemePaneOpen = vi.fn();
  const setSettingsDialogOpen = vi.fn();
  const editorRunner = overrides?.editorRunner ?? null;
  return {
    context: {
      setThemePaneOpen,
      isThemePaneOpen: vi.fn(() => overrides?.isThemePaneOpen ?? false),
      setSettingsDialogOpen,
      isSettingsDialogOpen: vi.fn(() => overrides?.isSettingsDialogOpen ?? false),
      notify,
      getState: () => appState.getSnapshot(),
      getWindowId: () => "main",
      confirm: vi.fn(overrides?.confirm ?? (() => true)),
      getEditorRunner: vi.fn(() => editorRunner),
    },
    notify,
    setThemePaneOpen,
    setSettingsDialogOpen,
    editorRunner,
  };
}

async function flushCommandQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("expandPlatformKeymaps", () => {
  it("builds mac and windows tokens from command definitions", () => {
    const keymap = expandPlatformKeymaps(commandDefinitions);
    expect(keymap["Meta+s"]).toBe("file.save");
    expect(keymap["Ctrl+s"]).toBe("file.save");
    expect(keymap["Alt+arrowup"]).toBe("edit.moveLineUp");
    expect(keymap["Ctrl+tab"]).toBe("tab.next");
    expect(keymap["Meta+Shift+]"]).toBe("tab.next");
  });
});

describe("keymapCommandForEvent", () => {
  beforeEach(() => {
    resetCommandBindingOverrides();
  });

  it("honors binding overrides", () => {
    setCommandBindingOverrides({ "file.new": { mac: "Cmd+Shift+O" } });
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "o", metaKey: true, shiftKey: true })),
    ).toBe("file.new");
    expect(keymapCommandForEvent(keyboardEvent({ key: "n", metaKey: true }))).toBeNull();
  });

  it("maps Meta+N to file.new", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "n", metaKey: true })),
    ).toBe("file.new");
  });

  it("maps Meta+S to file.save", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "s", metaKey: true })),
    ).toBe("file.save");
  });

  it("maps Ctrl+S to file.save", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "s", ctrlKey: true })),
    ).toBe("file.save");
  });

  it("maps Ctrl+Shift+S to file.saveAll", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "s", ctrlKey: true, shiftKey: true })),
    ).toBe("file.saveAll");
  });

  it("maps Ctrl+W to tab.close", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "w", ctrlKey: true })),
    ).toBe("tab.close");
  });

  it("maps Ctrl+Shift+M to view.toggleMarkdownPreview", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "m", ctrlKey: true, shiftKey: true })),
    ).toBe("view.toggleMarkdownPreview");
  });

  it("maps Ctrl+Tab to tab.next", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "Tab", ctrlKey: true })),
    ).toBe("tab.next");
  });

  it("maps Ctrl+Shift+Tab to tab.previous", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "Tab", ctrlKey: true, shiftKey: true })),
    ).toBe("tab.previous");
  });

  it("maps Meta+Shift+] to tab.next", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "]", metaKey: true, shiftKey: true })),
    ).toBe("tab.next");
  });

  it("returns null for unknown combos", () => {
    expect(
      keymapCommandForEvent(keyboardEvent({ key: "q", metaKey: true, shiftKey: true })),
    ).toBeNull();
  });

  it("maps every bound command to mac and windows keymap entries", () => {
    for (const definition of commandDefinitions) {
      if (!definition.binding) {
        continue;
      }
      if (definition.binding.mac === "none" || definition.binding.windows === "none") {
        continue;
      }

      expect(keymapCommandForEvent(keyboardEventFromBinding(definition.binding.mac, "mac"))).toBe(
        definition.id,
      );
      expect(
        keymapCommandForEvent(keyboardEventFromBinding(definition.binding.windows, "windows")),
      ).toBe(definition.id);
    }
  });
});

describe("isEditorGlobalCommand", () => {
  it("includes file.new and tab.close", () => {
    expect(isEditorGlobalCommand("file.new")).toBe(true);
    expect(isEditorGlobalCommand("tab.close")).toBe(true);
    expect(isEditorGlobalCommand("view.zoomIn")).toBe(false);
  });
});

describe("command registration", () => {
  it("registers a handler for every defined command", () => {
    const registered = new Set(getRegisteredCommandIds());
    const missing = commandDefinitions
      .map((definition) => definition.id)
      .filter((id) => !registered.has(id));

    expect(missing).toEqual([]);
  });
});

describe("getActiveDocumentContent", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("returns content for the selected tab", () => {
    appState.setDocumentContent("doc-1", "hello world");
    expect(getActiveDocumentContent()).toBe("hello world");
  });

  it("returns empty string for a new untitled tab", () => {
    appState.createTab();
    expect(getActiveDocumentContent()).toBe("");
  });
});

describe("file.save command", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(saveFile).mockReset();
    vi.mocked(saveFileAs).mockReset();
    vi.mocked(renameOpenFileRegistry).mockReset();
    vi.mocked(saveFile).mockResolvedValue(savedFingerprint);
    vi.mocked(renameOpenFileRegistry).mockResolvedValue(undefined);
  });

  it("saves a dirty document with a file path", async () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/draft.txt", "saved");
    appState.setDocumentContent("doc-1", "edited");

    dispatchCommand("file.save", context);
    await flushCommandQueue();

    expect(saveFile).toHaveBeenCalledWith({ path: "/tmp/draft.txt", content: "edited" });
    expect(appState.getActiveDocuments()[0]?.isDirty).toBe(false);
    expect(notify).toHaveBeenCalledWith("Saved /tmp/draft.txt");
  });

  it("prompts save-as for untitled documents and no-ops when cancelled", async () => {
    const { context } = createCommandContext();
    appState.setDocumentContent("doc-1", "untitled draft");
    vi.mocked(saveFileAs).mockResolvedValue(null);

    dispatchCommand("file.save", context);
    await flushCommandQueue();

    expect(saveFileAs).toHaveBeenCalled();
    expect(saveFile).not.toHaveBeenCalled();
    expect(appState.getActiveDocuments()[0]?.filePath).toBeNull();
  });

  it("saves an untitled document when save-as succeeds", async () => {
    const { context, notify } = createCommandContext();
    appState.setDocumentContent("doc-1", "untitled draft");
    vi.mocked(saveFileAs).mockResolvedValue({ path: "/tmp/new.txt", fingerprint: savedFingerprint });

    dispatchCommand("file.save", context);
    await flushCommandQueue();

    expect(appState.getActiveDocuments()[0]?.filePath).toBe("/tmp/new.txt");
    expect(notify).toHaveBeenCalledWith("Saved /tmp/new.txt");
  });
});

describe("file.saveAll command", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(saveFile).mockReset();
    vi.mocked(saveFileAs).mockReset();
    vi.mocked(renameOpenFileRegistry).mockReset();
    vi.mocked(saveFile).mockResolvedValue(savedFingerprint);
    vi.mocked(renameOpenFileRegistry).mockResolvedValue(undefined);
  });

  it("saves every dirty document", async () => {
    const { context, notify } = createCommandContext();
    appState.createTab();
    appState.markDocumentSaved("doc-1", "/tmp/a.txt", "a");
    appState.setDocumentContent("doc-1", "a-edited");
    appState.markDocumentSaved("doc-2", "/tmp/b.txt", "b");
    appState.setDocumentContent("doc-2", "b-edited");

    dispatchCommand("file.saveAll", context);
    await flushCommandQueue();

    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("Saved 2 document(s).");
  });

  it("no-ops when every document is clean", async () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/clean.txt", "clean");

    dispatchCommand("file.saveAll", context);
    await flushCommandQueue();

    expect(saveFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No dirty documents to save.");
  });
});

describe("file.new command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("creates a tab and notifies", () => {
    const { context, notify } = createCommandContext();

    dispatchCommand("file.new", context);

    expect(appState.getActiveSession().openTabs).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith("New tab created.");
  });
});

describe("tab.close command", () => {
  beforeEach(() => {
    appState.resetAppState();
    closeTabWithUnsavedPromptMock.mockReset();
  });

  it("closes a clean tab", async () => {
    const { context, notify } = createCommandContext();
    appState.createTab();
    closeTabWithUnsavedPromptMock.mockResolvedValue(true);

    dispatchCommand("tab.close", context);
    await flushCommandQueue();

    expect(closeTabWithUnsavedPromptMock).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Tab closed.");
  });

  it("cancels close when a dirty tab is not confirmed", async () => {
    const { context, notify } = createCommandContext();
    appState.createTab();
    appState.setDocumentContent("doc-2", "dirty");
    closeTabWithUnsavedPromptMock.mockResolvedValue(false);

    dispatchCommand("tab.close", context);
    await flushCommandQueue();

    expect(appState.getActiveSession().openTabs).toHaveLength(2);
    expect(notify).not.toHaveBeenCalledWith("Tab closed.");
  });
});

describe("workspace.add command", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(openFolderDialog).mockReset();
    vi.mocked(ensureWorkspaceReadAccess).mockReset();
  });

  it("does not add workspace when access check is blocked", async () => {
    const { context, notify } = createCommandContext();
    vi.mocked(openFolderDialog).mockResolvedValue("/tmp/blocked");
    vi.mocked(ensureWorkspaceReadAccess).mockResolvedValue("blocked");

    dispatchCommand("workspace.add", context);
    await flushCommandQueue();

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("Workspace path is inaccessible. Check permissions and try again.");
  });

  it("adds a workspace when folder selection succeeds", async () => {
    const { context, notify } = createCommandContext();
    vi.mocked(openFolderDialog).mockResolvedValue("/tmp/project");
    vi.mocked(ensureWorkspaceReadAccess).mockResolvedValue("ready");

    dispatchCommand("workspace.add", context);
    await flushCommandQueue();

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
    expect(appState.getSnapshot().contexts.workspaces[0]?.rootPath).toBe("/tmp/project");
    expect(notify).toHaveBeenCalledWith("Workspace added.");
  });

  it("no-ops when folder dialog is cancelled", async () => {
    const { context, notify } = createCommandContext();
    vi.mocked(openFolderDialog).mockResolvedValue(null);

    dispatchCommand("workspace.add", context);
    await flushCommandQueue();

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("view.toggleMarkdownPreview command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("cycles the active markdown document between edit and preview", () => {
    const { context, notify } = createCommandContext();
    appState.openFileInTab("/tmp/readme.md", "# Hello");

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

describe("workspace.close command", () => {
  let confirmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appState.resetAppState();
    confirmMock = vi.fn();
    vi.stubGlobal("window", { confirm: confirmMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes a clean workspace", () => {
    const { context, notify } = createCommandContext();
    appState.addWorkspace("/tmp/ws");

    dispatchCommand("workspace.close", context);

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("Workspace closed.");
  });

  it("cancels close when dirty workspace prompts are declined", () => {
    const { context, notify } = createCommandContext();
    appState.addWorkspace("/tmp/ws-dirty");
    const activeDocumentId = appState.getActiveDocuments()[0]?.id;
    expect(activeDocumentId).toBeDefined();
    appState.setDocumentContent(activeDocumentId!, "dirty workspace doc");
    confirmMock.mockReturnValueOnce(false).mockReturnValueOnce(false);

    dispatchCommand("workspace.close", context);

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(1);
    expect(notify).not.toHaveBeenCalledWith("Workspace closed.");
  });

  it("discards dirty changes when the user confirms discard", () => {
    const { context, notify } = createCommandContext();
    appState.addWorkspace("/tmp/ws-discard");
    const activeDocumentId = appState.getActiveDocuments()[0]?.id;
    expect(activeDocumentId).toBeDefined();
    appState.setDocumentContent(activeDocumentId!, "dirty workspace doc");
    confirmMock.mockReturnValueOnce(false).mockReturnValueOnce(true);

    dispatchCommand("workspace.close", context);

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("Workspace closed.");
  });
});

describe("workspace.reorder command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("reorders workspaces from payload without changing active context", () => {
    const { context } = createCommandContext();
    appState.addWorkspace("/tmp/ws-a");
    const wsAId = appState.getSnapshot().contexts.workspaces[0]?.id;
    appState.addWorkspace("/tmp/ws-b");
    appState.switchContext("notepad");
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");

    dispatchCommand("workspace.reorder", context, { fromIndex: 1, toIndex: 0 });

    expect(appState.getSnapshot().contexts.workspaces.map((workspace) => workspace.rootPath)).toEqual([
      "/tmp/ws-b",
      "/tmp/ws-a",
    ]);
    expect(appState.getSnapshot().contexts.activeContextId).toBe("notepad");
    expect(appState.getSnapshot().contexts.workspaces[1]?.id).toBe(wsAId);
  });

  it("ignores invalid payload", () => {
    const { context } = createCommandContext();
    appState.addWorkspace("/tmp/ws-a");
    appState.addWorkspace("/tmp/ws-b");

    dispatchCommand("workspace.reorder", context, { fromIndex: 0 });
    dispatchCommand("workspace.reorder", context, null);

    expect(appState.getSnapshot().contexts.workspaces.map((workspace) => workspace.rootPath)).toEqual([
      "/tmp/ws-a",
      "/tmp/ws-b",
    ]);
  });
});

describe("app shell toggle commands", () => {
  it("app.toggleThemePane opens the theme pane when closed", () => {
    const { context, setThemePaneOpen } = createCommandContext();

    dispatchCommand("app.toggleThemePane", context);

    expect(setThemePaneOpen).toHaveBeenCalledWith(true);
  });

  it("app.toggleSettings opens settings when closed", () => {
    const { context, setSettingsDialogOpen } = createCommandContext();

    dispatchCommand("app.toggleSettings", context);

    expect(setSettingsDialogOpen).toHaveBeenCalledWith(true);
  });

  it("app.toggleSettings closes settings when already open", () => {
    const { context, setSettingsDialogOpen } = createCommandContext({ isSettingsDialogOpen: true });

    dispatchCommand("app.toggleSettings", context);

    expect(setSettingsDialogOpen).toHaveBeenCalledWith(false);
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

  it("view.cycleTheme toggles the active builtin theme", () => {
    const { context } = createCommandContext();
    appState.setTheme("dark-amber");

    dispatchCommand("view.cycleTheme", context);

    expect(appState.getSnapshot().theme.activeTheme).toEqual({
      kind: "builtin",
      id: "light-blue",
    });
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
});

describe("file.open command", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(openFileDialog).mockReset();
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockReset();
  });

  it("opens a selected file through the open gate", async () => {
    const { context, notify } = createCommandContext();
    vi.mocked(openFileDialog).mockResolvedValue({
      path: "/tmp/open.txt",
      content: "hello",
      sizeBytes: 5,
      contentKind: "text",
    });
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: "/tmp/open.txt",
      switchedToNotepad: false,
    });
    completeOpenPathMock.mockResolvedValue("doc-2");

    dispatchCommand("file.open", context);
    await flushCommandQueue();

    expect(openFileDialog).toHaveBeenCalled();
    expect(completeOpenPathMock).toHaveBeenCalledWith("/tmp/open.txt", "hello", "main", "text");
    expect(notify).toHaveBeenCalledWith("Opened /tmp/open.txt");
  });

  it("no-ops when the file dialog is cancelled", async () => {
    const { context, notify } = createCommandContext();
    vi.mocked(openFileDialog).mockResolvedValue(null);

    dispatchCommand("file.open", context);
    await flushCommandQueue();

    expect(requestOpenPathMock).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("file.openRecent command", () => {
  beforeEach(() => {
    appState.resetAppState();
    takeQueuedOpenRecentPathMock.mockReset();
    openActivePathMock.mockReset();
  });

  it("opens a queued recent file path", async () => {
    const { context, notify } = createCommandContext();
    takeQueuedOpenRecentPathMock.mockReturnValue("/tmp/recent.txt");
    openActivePathMock.mockResolvedValue({ kind: "opened", path: "/tmp/recent.txt" });

    dispatchCommand("file.openRecent", context);
    await flushCommandQueue();

    expect(openActivePathMock).toHaveBeenCalledWith("/tmp/recent.txt", "main");
    expect(notify).toHaveBeenCalledWith("Opened /tmp/recent.txt");
  });

  it("no-ops when no recent path is queued", async () => {
    const { context, notify } = createCommandContext();
    takeQueuedOpenRecentPathMock.mockReturnValue(null);

    dispatchCommand("file.openRecent", context);
    await flushCommandQueue();

    expect(openActivePathMock).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("file.clearRecentFiles command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("clears recent files from app state", () => {
    const { context } = createCommandContext();
    appState.touchRecentFile("/tmp/a.txt");
    appState.touchRecentFile("/tmp/b.txt");

    dispatchCommand("file.clearRecentFiles", context);

    expect(appState.getSnapshot().recentFiles).toEqual([]);
  });
});

describe("file.openAllInFolder command", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(openFolderDialog).mockReset();
    collectOpenableFolderFilesMock.mockReset();
    openAllInFolderMock.mockReset();
    dirnameMock.mockReset();
  });

  it("opens matched files and reports the summary", async () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/project/readme.md", "# Hello");
    dirnameMock.mockResolvedValue("/tmp/project");
    vi.mocked(openFolderDialog).mockResolvedValue("/tmp/project");
    collectOpenableFolderFilesMock.mockResolvedValue(["/tmp/project/a.ts", "/tmp/project/b.ts"]);
    openAllInFolderMock.mockResolvedValue({
      opened: 2,
      skippedExisting: 0,
      skippedTooLarge: 0,
      skippedFailed: 0,
      focusedExisting: false,
    });

    dispatchCommand("file.openAllInFolder", context);
    await flushCommandQueue();

    expect(openAllInFolderMock).toHaveBeenCalledWith(["/tmp/project/a.ts", "/tmp/project/b.ts"], "main");
    expect(notify).toHaveBeenCalledWith("Opened 2 file(s).");
  });

  it("notifies when the folder has no openable files", async () => {
    const { context, notify } = createCommandContext();
    vi.mocked(openFolderDialog).mockResolvedValue("/tmp/empty");
    collectOpenableFolderFilesMock.mockResolvedValue([]);

    dispatchCommand("file.openAllInFolder", context);
    await flushCommandQueue();

    expect(openAllInFolderMock).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No openable files in folder.");
  });

  it("aborts when the user declines a large-folder confirmation", async () => {
    const { context, notify } = createCommandContext({ confirm: () => false });
    vi.mocked(openFolderDialog).mockResolvedValue("/tmp/large");
    collectOpenableFolderFilesMock.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => `/tmp/large/file-${index}.ts`),
    );

    dispatchCommand("file.openAllInFolder", context);
    await flushCommandQueue();

    expect(openAllInFolderMock).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("file.saveAs command", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(saveFileAs).mockReset();
    vi.mocked(renameOpenFileRegistry).mockReset();
    vi.mocked(renameOpenFileRegistry).mockResolvedValue(undefined);
  });

  it("saves the active document to a new path", async () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/original.txt", "original");
    appState.setDocumentContent("doc-1", "edited");
    vi.mocked(saveFileAs).mockResolvedValue({ path: "/tmp/copy.txt", fingerprint: savedFingerprint });

    dispatchCommand("file.saveAs", context);
    await flushCommandQueue();

    expect(appState.getActiveDocuments()[0]?.filePath).toBe("/tmp/copy.txt");
    expect(notify).toHaveBeenCalledWith("Saved as /tmp/copy.txt");
  });

  it("no-ops when save-as is cancelled", async () => {
    const { context, notify } = createCommandContext();
    appState.setDocumentContent("doc-1", "draft");
    vi.mocked(saveFileAs).mockResolvedValue(null);

    dispatchCommand("file.saveAs", context);
    await flushCommandQueue();

    expect(appState.getActiveDocuments()[0]?.filePath).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("file.rename command", () => {
  beforeEach(() => {
    appState.resetAppState();
    renameDocumentOnDiskMock.mockReset();
    renameDocumentOnDiskMock.mockResolvedValue(undefined);
  });

  it("delegates rename to the document rename service", async () => {
    const { context } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/rename-me.txt", "rename me");

    dispatchCommand("file.rename", context);
    await flushCommandQueue();

    expect(renameDocumentOnDiskMock).toHaveBeenCalledWith("doc-1", {
      windowId: "main",
      notify: context.notify,
    });
  });

  it("no-ops when the active tab is not a file tab", async () => {
    const { context, notify } = createCommandContext();
    appState.addWorkspace("/tmp/ws");
    appState.openOrFocusAgentTab("agent-a");

    dispatchCommand("file.rename", context);
    await flushCommandQueue();

    expect(renameDocumentOnDiskMock).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No active file tab to save.");
  });
});

describe("file.reloadFromDisk command", () => {
  beforeEach(() => {
    appState.resetAppState();
    reloadActiveDocumentFromDiskMock.mockReset();
  });

  it("reloads a saved document and notifies on success", async () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/reload.txt", "saved");
    reloadActiveDocumentFromDiskMock.mockResolvedValue("reloaded");

    dispatchCommand("file.reloadFromDisk", context);
    await flushCommandQueue();

    expect(notify).toHaveBeenCalledWith("Reloaded /tmp/reload.txt from disk.");
  });

  it("guards reload for untitled documents", async () => {
    const { context, notify } = createCommandContext();
    appState.setDocumentContent("doc-1", "untitled");

    dispatchCommand("file.reloadFromDisk", context);
    await flushCommandQueue();

    expect(reloadActiveDocumentFromDiskMock).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Save the document before reloading from disk.");
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

    expect(appState.getActiveSession().selectedTabId).toBe("tab-2");
  });

  it("tab.previous selects the previous tab", () => {
    const { context } = createCommandContext();
    appState.createTab();
    const tabs = appState.getActiveSession().openTabs;
    appState.selectTab(tabs[1]!.id);

    dispatchCommand("tab.previous", context);

    expect(appState.getActiveSession().selectedTabId).toBe(tabs[0]?.id);
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

describe("command dispatch coverage", () => {
  it("tracks at least one dispatch test per defined command", () => {
    const testedIds = new Set([
      "app.toggleThemePane",
      "app.toggleSettings",
      "app.newWindow",
      "view.cycleTheme",
      "app.toggleFindReplace",
      "app.toggleGoTo",
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
    ]);

    const missing = commandDefinitions
      .map((definition) => definition.id)
      .filter((id) => !testedIds.has(id));

    expect(missing).toEqual([]);
  });
});
