import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiskFingerprint } from "../../domain/contracts";
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
    appState.openOrFocusSessionTab("agent-a");

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

