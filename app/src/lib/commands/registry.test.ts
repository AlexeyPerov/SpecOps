import { beforeEach, describe, expect, it, vi } from "vitest";
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
}));

vi.mock("../services/openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn(),
}));

vi.mock("../services/externalFileChanges", () => ({
  reloadActiveDocumentFromDisk: vi.fn(),
}));

vi.mock("../services/windowManager", () => ({
  createNewWindowWithTransfer: vi.fn(),
}));

import {
  dispatchCommand,
  commandDefinitions,
  getActiveDocumentContent,
  getRegisteredCommandIds,
  keymapCommandForEvent,
} from "./registry";
import { ensureWorkspaceReadAccess, openFolderDialog } from "../services/fileSystem";

describe("keymapCommandForEvent", () => {
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

describe("workspace.add command", () => {
  const notify = vi.fn();
  const commandContext = {
    setThemePaneOpen: vi.fn(),
    isThemePaneOpen: vi.fn(() => false),
    setSettingsDialogOpen: vi.fn(),
    isSettingsDialogOpen: vi.fn(() => false),
    notify,
    getState: () => appState.getSnapshot(),
    getWindowId: () => "main",
    confirm: vi.fn(() => true),
    getEditorRunner: vi.fn(() => null),
  };

  beforeEach(() => {
    appState.resetAppState();
    notify.mockReset();
    vi.mocked(openFolderDialog).mockReset();
    vi.mocked(ensureWorkspaceReadAccess).mockReset();
  });

  it("does not add workspace when access check is blocked", async () => {
    vi.mocked(openFolderDialog).mockResolvedValue("/tmp/blocked");
    vi.mocked(ensureWorkspaceReadAccess).mockResolvedValue("blocked");

    dispatchCommand("workspace.add", commandContext);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("Workspace path is inaccessible. Check permissions and try again.");
  });
});
