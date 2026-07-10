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
  confirm?: (message: string) => Promise<boolean>;
  editorRunner?: EditorCommandRunner | null;
}) {
  const notify = vi.fn();
  const editorRunner = overrides?.editorRunner ?? null;
  return {
    context: {
      notify,
      getState: () => appState.getSnapshot(),
      getWindowId: () => "main",
      confirm: vi.fn(overrides?.confirm ?? (() => Promise.resolve(true))),
      getEditorRunner: vi.fn(() => editorRunner),
    },
    notify,
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

