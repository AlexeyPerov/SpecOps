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
import {
  ensureWorkspaceReadAccess,
  openFolderDialog,
  saveFile,
  saveFileAs,
} from "../services/fileSystem";
import { renameOpenFileRegistry } from "../services/openFileRegistry";

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

function createCommandContext(overrides?: { confirm?: (message: string) => boolean }) {
  const notify = vi.fn();
  return {
    context: {
      setThemePaneOpen: vi.fn(),
      isThemePaneOpen: vi.fn(() => false),
      setSettingsDialogOpen: vi.fn(),
      isSettingsDialogOpen: vi.fn(() => false),
      notify,
      getState: () => appState.getSnapshot(),
      getWindowId: () => "main",
      confirm: vi.fn(overrides?.confirm ?? (() => true)),
      getEditorRunner: vi.fn(() => null),
    },
    notify,
  };
}

async function flushCommandQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
    expect(appState.getSnapshot().documents[0]?.isDirty).toBe(false);
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
    expect(appState.getSnapshot().documents[0]?.filePath).toBeNull();
  });

  it("saves an untitled document when save-as succeeds", async () => {
    const { context, notify } = createCommandContext();
    appState.setDocumentContent("doc-1", "untitled draft");
    vi.mocked(saveFileAs).mockResolvedValue({ path: "/tmp/new.txt", fingerprint: savedFingerprint });

    dispatchCommand("file.save", context);
    await flushCommandQueue();

    expect(appState.getSnapshot().documents[0]?.filePath).toBe("/tmp/new.txt");
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

    expect(appState.getSnapshot().session.openTabs).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith("New tab created.");
  });
});

describe("tab.close command", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("closes a clean tab", () => {
    const { context, notify } = createCommandContext();
    appState.createTab();

    dispatchCommand("tab.close", context);

    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith("Tab closed.");
  });

  it("cancels close when a dirty tab is not confirmed", () => {
    const { context, notify } = createCommandContext({ confirm: () => false });
    appState.createTab();
    appState.setDocumentContent("doc-2", "dirty");

    dispatchCommand("tab.close", context);

    expect(appState.getSnapshot().session.openTabs).toHaveLength(2);
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
      appState.getSnapshot().documents.find((doc) => doc.id === "doc-2")?.markdownViewMode,
    ).toBe("preview");
    expect(notify).toHaveBeenCalledWith("Markdown preview on.");

    dispatchCommand("view.toggleMarkdownPreview", context);
    expect(
      appState.getSnapshot().documents.find((doc) => doc.id === "doc-2")?.markdownViewMode,
    ).toBe("edit");
    expect(notify).toHaveBeenCalledWith("Markdown preview off.");
  });

  it("no-ops with a status message for non-markdown files", () => {
    const { context, notify } = createCommandContext();
    appState.markDocumentSaved("doc-1", "/tmp/plain.txt", "hello");

    dispatchCommand("view.toggleMarkdownPreview", context);

    expect(notify).toHaveBeenCalledWith("Markdown preview is only available for markdown files.");
    expect(appState.getSnapshot().documents[0]?.markdownViewMode).toBe("edit");
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
    const activeDocumentId = appState.getSnapshot().documents[0]?.id;
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
    const activeDocumentId = appState.getSnapshot().documents[0]?.id;
    expect(activeDocumentId).toBeDefined();
    appState.setDocumentContent(activeDocumentId!, "dirty workspace doc");
    confirmMock.mockReturnValueOnce(false).mockReturnValueOnce(true);

    dispatchCommand("workspace.close", context);

    expect(appState.getSnapshot().contexts.workspaces).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith("Workspace closed.");
  });
});
