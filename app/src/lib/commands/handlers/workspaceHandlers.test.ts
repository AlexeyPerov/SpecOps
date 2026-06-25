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
}) {
  const notify = vi.fn();
  const editorRunner = overrides?.editorRunner ?? null;
  return {
    context: {
      notify,
      getState: () => appState.getSnapshot(),
      getWindowId: () => "main",
      confirm: vi.fn(overrides?.confirm ?? (() => true)),
      getEditorRunner: vi.fn(() => editorRunner),
    },
    notify,
    editorRunner,
  };
}

async function flushCommandQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

