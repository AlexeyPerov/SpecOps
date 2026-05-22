import { get } from "svelte/store";
import type { AppCommandId, AppDomainState, CommandDefinition } from "../domain/contracts";
import { appState } from "../state/appState";
import { logDiagnostic } from "../services/logging";
import type { EditorCommandRunner } from "../types/editor";
import { openFileDialog, renameFile, saveFile, saveFileAs } from "../services/fileSystem";
import { completeOpenPath, requestOpenPath } from "../services/openFileGate";
import { renameOpenFileRegistry } from "../services/openFileRegistry";
import { createNewWindowWithTransfer } from "../services/windowManager";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

type CommandContext = {
  setSettingsPaneOpen: (next: boolean) => void;
  isSettingsPaneOpen: () => boolean;
  notify: (message: string) => void;
  getState: () => AppDomainState;
  getWindowId: () => string;
  confirm: (message: string) => boolean;
  getEditorRunner: () => EditorCommandRunner | null;
};

type CommandHandler = (context: CommandContext) => Promise<void> | void;

function getSnapshot() {
  return get(appState);
}

function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause: error.cause ?? null,
    };
  }

  let jsonValue: string | null = null;
  try {
    jsonValue = JSON.stringify(error);
  } catch {
    jsonValue = null;
  }

  return {
    type: typeof error,
    value: String(error),
    json: jsonValue,
  };
}

function sanitizePermissionNoise(value: string): string {
  const marker = "Permissions associated with this command:";
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) {
    return value;
  }
  return value.slice(0, markerIndex).trim();
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizePermissionNoise(error.message || error.name || "Unknown command error");
  }
  if (typeof error === "string") {
    return sanitizePermissionNoise(error);
  }
  return "Unknown command error";
}

function sanitizeErrorDetails(details: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...details };
  if (typeof cleaned.message === "string") {
    cleaned.message = sanitizePermissionNoise(cleaned.message);
  }
  if (typeof cleaned.value === "string") {
    cleaned.value = sanitizePermissionNoise(cleaned.value);
  }
  delete cleaned.json;
  return cleaned;
}

async function openAndStoreFile(
  notify: (message: string) => void,
  windowId: string,
  opened: { path: string; content: string; sizeBytes: number } | null,
): Promise<void> {
  if (!opened) {
    return;
  }
  if (opened.sizeBytes > 10 * 1024 * 1024) {
    notify("Open failed: file exceeds 10MB MVP limit.");
    return;
  }

  const gateResult = await requestOpenPath(opened.path, windowId);
  if (gateResult.kind === "redirected") {
    notify(`Switched to ${opened.path} in another window.`);
    return;
  }
  if (gateResult.kind === "existing") {
    notify(`Opened ${opened.path}`);
    return;
  }

  await completeOpenPath(opened.path, opened.content, windowId);
  notify(`Opened ${opened.path}`);
}

const keyBindingsByPlatform: Record<string, string> = {
  "Meta+,": "app.toggleSettingsPane",
  "Meta+Shift+t": "view.toggleTheme",
  "Meta+f": "app.toggleFindReplace",
  "Meta+l": "app.toggleGoTo",
  "Meta+Shift+m": "view.toggleMarkdownPreview",
  "Meta+Shift+d": "view.toggleDiffPreview",
  "Meta+n": "file.new",
  "Meta+o": "file.open",
  "Meta+s": "file.save",
  "Meta+Shift+s": "file.saveAs",
  "Meta+Alt+s": "file.saveAll",
  "Meta+w": "tab.close",
  "Meta+Shift+n": "app.newWindow",
  "Meta+Shift+]": "tab.next",
  "Meta+Shift+[": "tab.previous",
  "Meta+z": "edit.undo",
  "Meta+Shift+z": "edit.redo",
  "Meta+]": "edit.indent",
  "Meta+[": "edit.outdent",
  "Alt+arrowup": "edit.moveLineUp",
  "Alt+arrowdown": "edit.moveLineDown",
  "Meta+d": "edit.duplicateLine",
  "Meta+j": "edit.joinLines",
  "Meta+Alt+z": "view.toggleWrap",
  "Meta+=": "view.zoomIn",
  "Meta+-": "view.zoomOut",
  "Meta+0": "view.zoomReset",
  "Ctrl+,": "app.toggleSettingsPane",
  "Ctrl+Shift+t": "view.toggleTheme",
  "Ctrl+f": "app.toggleFindReplace",
  "Ctrl+l": "app.toggleGoTo",
  "Ctrl+Shift+m": "view.toggleMarkdownPreview",
  "Ctrl+Shift+d": "view.toggleDiffPreview",
  "Ctrl+n": "file.new",
  "Ctrl+o": "file.open",
  "Ctrl+s": "file.save",
  "Ctrl+Shift+s": "file.saveAs",
  "Ctrl+Alt+s": "file.saveAll",
  "Ctrl+w": "tab.close",
  "Ctrl+Shift+n": "app.newWindow",
  "Ctrl+tab": "tab.next",
  "Ctrl+Shift+tab": "tab.previous",
  "Ctrl+z": "edit.undo",
  "Ctrl+y": "edit.redo",
  "Ctrl+]": "edit.indent",
  "Ctrl+[": "edit.outdent",
  "Ctrl+d": "edit.duplicateLine",
  "Ctrl+j": "edit.joinLines",
  "Ctrl+Alt+z": "view.toggleWrap",
  "Ctrl+=": "view.zoomIn",
  "Ctrl+-": "view.zoomOut",
  "Ctrl+0": "view.zoomReset",
};

export const commandDefinitions: CommandDefinition[] = [
  {
    id: "app.toggleSettingsPane",
    label: "Toggle Settings Pane",
    menuPath: "View/Settings Pane",
    binding: { mac: "Cmd+,", windows: "Ctrl+," },
  },
  {
    id: "app.newWindow",
    label: "New Window",
    menuPath: "File/New Window",
    binding: { mac: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
  },
  {
    id: "view.toggleTheme",
    label: "Toggle Theme",
    menuPath: "View/Theme",
    binding: { mac: "Cmd+Shift+T", windows: "Ctrl+Shift+T" },
  },
  {
    id: "app.toggleFindReplace",
    label: "Find / Replace",
    menuPath: "Edit/Find Replace",
    binding: { mac: "Cmd+F", windows: "Ctrl+F" },
  },
  {
    id: "app.toggleGoTo",
    label: "Go To Line",
    menuPath: "Edit/Go To",
    binding: { mac: "Cmd+L", windows: "Ctrl+L" },
  },
  {
    id: "view.toggleMarkdownPreview",
    label: "Markdown Preview",
    menuPath: "Hidden/Markdown Preview",
    binding: { mac: "Cmd+Shift+M", windows: "Ctrl+Shift+M" },
  },
  {
    id: "view.toggleDiffPreview",
    label: "Diff Preview",
    menuPath: "View/Diff Preview",
    binding: { mac: "Cmd+Shift+D", windows: "Ctrl+Shift+D" },
  },
  {
    id: "file.new",
    label: "New Tab",
    menuPath: "File/New",
    binding: { mac: "Cmd+N", windows: "Ctrl+N" },
  },
  {
    id: "file.open",
    label: "Open File",
    menuPath: "File/Open",
    binding: { mac: "Cmd+O", windows: "Ctrl+O" },
  },
  {
    id: "file.save",
    label: "Save",
    menuPath: "File/Save",
    binding: { mac: "Cmd+S", windows: "Ctrl+S" },
  },
  {
    id: "file.saveAs",
    label: "Save As",
    menuPath: "File/Save As",
    binding: { mac: "Cmd+Shift+S", windows: "Ctrl+Shift+S" },
  },
  {
    id: "file.saveAll",
    label: "Save All",
    menuPath: "File/Save All",
    binding: { mac: "Cmd+Alt+S", windows: "Ctrl+Alt+S" },
  },
  {
    id: "file.rename",
    label: "Rename",
    menuPath: "File/Rename",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "tab.close",
    label: "Close Tab",
    menuPath: "Tab/Close",
    binding: { mac: "Cmd+W", windows: "Ctrl+W" },
  },
  {
    id: "tab.moveToNewWindow",
    label: "Move Tab To New Window",
    menuPath: "Tab/Move To New Window",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "tab.next",
    label: "Next Tab",
    menuPath: "Tab/Next",
    binding: { mac: "Cmd+Shift+]", windows: "Ctrl+Tab" },
  },
  {
    id: "tab.previous",
    label: "Previous Tab",
    menuPath: "Tab/Previous",
    binding: { mac: "Cmd+Shift+[", windows: "Ctrl+Shift+Tab" },
  },
  {
    id: "edit.undo",
    label: "Undo",
    menuPath: "Edit/Undo",
    binding: { mac: "Cmd+Z", windows: "Ctrl+Z" },
  },
  {
    id: "edit.redo",
    label: "Redo",
    menuPath: "Edit/Redo",
    binding: { mac: "Cmd+Shift+Z", windows: "Ctrl+Y" },
  },
  {
    id: "edit.indent",
    label: "Indent",
    menuPath: "Edit/Indent",
    binding: { mac: "Cmd+]", windows: "Ctrl+]" },
  },
  {
    id: "edit.outdent",
    label: "Outdent",
    menuPath: "Edit/Outdent",
    binding: { mac: "Cmd+[", windows: "Ctrl+[" },
  },
  {
    id: "edit.moveLineUp",
    label: "Move Line Up",
    menuPath: "Edit/Move Line Up",
    binding: { mac: "Alt+Up", windows: "Alt+Up" },
  },
  {
    id: "edit.moveLineDown",
    label: "Move Line Down",
    menuPath: "Edit/Move Line Down",
    binding: { mac: "Alt+Down", windows: "Alt+Down" },
  },
  {
    id: "edit.duplicateLine",
    label: "Duplicate Line",
    menuPath: "Edit/Duplicate Line",
    binding: { mac: "Cmd+D", windows: "Ctrl+D" },
  },
  {
    id: "edit.joinLines",
    label: "Join Lines",
    menuPath: "Edit/Join Lines",
    binding: { mac: "Cmd+J", windows: "Ctrl+J" },
  },
  {
    id: "view.toggleWrap",
    label: "Toggle Wrap",
    menuPath: "View/Toggle Wrap",
    binding: { mac: "Cmd+Alt+Z", windows: "Ctrl+Alt+Z" },
  },
  {
    id: "view.zoomIn",
    label: "Zoom In",
    menuPath: "View/Zoom In",
    binding: { mac: "Cmd+=", windows: "Ctrl+=" },
  },
  {
    id: "view.zoomOut",
    label: "Zoom Out",
    menuPath: "View/Zoom Out",
    binding: { mac: "Cmd+-", windows: "Ctrl+-" },
  },
  {
    id: "view.zoomReset",
    label: "Reset Zoom",
    menuPath: "View/Reset Zoom",
    binding: { mac: "Cmd+0", windows: "Ctrl+0" },
  },
];

const handlers: Record<AppCommandId, CommandHandler> = {
  "app.toggleSettingsPane": ({ isSettingsPaneOpen, setSettingsPaneOpen }) => {
    setSettingsPaneOpen(!isSettingsPaneOpen());
  },
  "app.newWindow": async ({ getState, notify }) => {
    await createNewWindowWithTransfer(getState(), null);
    notify("Opened new window.");
  },
  "view.toggleTheme": () => {
    appState.toggleTheme();
  },
  "view.cycleAccent": () => {
    appState.cycleAccent();
  },
  "app.toggleFindReplace": () => {
    appState.toggleFindReplace();
  },
  "app.toggleGoTo": () => {
    appState.toggleGoTo();
  },
  "view.toggleMarkdownPreview": ({ getState, notify }) => {
    const next =
      getState().editor.previewMode === "markdown" ? "editor" : "markdown";
    appState.setPreviewMode(next);
    notify(next === "markdown" ? "Markdown preview on." : "Markdown preview off.");
  },
  "view.toggleDiffPreview": ({ getState, notify }) => {
    const next = getState().editor.previewMode === "diff" ? "editor" : "diff";
    appState.setPreviewMode(next);
    notify(next === "diff" ? "Diff preview on." : "Diff preview off.");
  },
  "file.new": ({ notify }) => {
    appState.createTab();
    notify("New tab created.");
  },
  "file.open": async ({ notify, getWindowId }) => {
    try {
      const opened = await openFileDialog();
      await openAndStoreFile(notify, getWindowId(), opened);
    } catch (error: unknown) {
      const reason = summarizeError(error);
      const details = sanitizeErrorDetails(serializeUnknownError(error));
      await logDiagnostic({
        level: "error",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: `file.open handler failed (${reason})`,
        metadata: details,
      });
      throw error;
    }
  },
  "file.save": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selected = state.session.openTabs.find(
      (tab) => tab.id === state.session.selectedTabId,
    );
    if (!selected) {
      notify("No active tab to save.");
      return;
    }
    const doc = state.documents.find((document) => document.id === selected.documentId);
    if (!doc) {
      return;
    }

    let targetPath = doc.filePath;
    const previousPath = doc.filePath;
    if (!targetPath) {
      targetPath = await saveFileAs(doc.content);
      if (!targetPath) {
        return;
      }
    } else {
      await saveFile({ path: targetPath, content: doc.content });
    }
    appState.markDocumentSaved(doc.id, targetPath, doc.content);
    await renameOpenFileRegistry(previousPath, targetPath, getWindowId(), doc.id);
    notify(`Saved ${targetPath}`);
  },
  "file.saveAs": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selected = state.session.openTabs.find(
      (tab) => tab.id === state.session.selectedTabId,
    );
    if (!selected) {
      notify("No active tab to save.");
      return;
    }
    const doc = state.documents.find((document) => document.id === selected.documentId);
    if (!doc) {
      return;
    }
    const targetPath = await saveFileAs(doc.content);
    if (!targetPath) {
      return;
    }
    const previousPath = doc.filePath;
    appState.markDocumentSaved(doc.id, targetPath, doc.content);
    await renameOpenFileRegistry(previousPath, targetPath, getWindowId(), doc.id);
    notify(`Saved as ${targetPath}`);
  },
  "file.saveAll": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    let saved = 0;
    for (const documentState of state.documents) {
      if (!documentState.isDirty) {
        continue;
      }
      let targetPath = documentState.filePath;
      const previousPath = documentState.filePath;
      if (!targetPath) {
        targetPath = await saveFileAs(documentState.content);
        if (!targetPath) {
          continue;
        }
      } else {
        await saveFile({ path: targetPath, content: documentState.content });
      }
      appState.markDocumentSaved(documentState.id, targetPath, documentState.content);
      await renameOpenFileRegistry(
        previousPath,
        targetPath,
        getWindowId(),
        documentState.id,
      );
      saved += 1;
    }
    notify(saved > 0 ? `Saved ${saved} document(s).` : "No dirty documents to save.");
  },
  "file.rename": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selected = state.session.openTabs.find(
      (tab) => tab.id === state.session.selectedTabId,
    );
    if (!selected) {
      return;
    }
    const doc = state.documents.find((document) => document.id === selected.documentId);
    if (!doc?.filePath) {
      notify("Save document before renaming.");
      return;
    }
    const renamedPath = await renameFile(doc.filePath);
    if (!renamedPath) {
      return;
    }
    const title = renamedPath.replaceAll("\\", "/").split("/").pop() ?? renamedPath;
    appState.renameDocument(doc.id, renamedPath, title);
    await renameOpenFileRegistry(doc.filePath, renamedPath, getWindowId(), doc.id);
    notify(`Renamed to ${title}`);
  },
  "file.reloadFromDisk": ({ notify }) => {
    notify("Reload from disk will be available after external file change handling is wired.");
  },
  "tab.close": ({ getState, confirm, notify }) => {
    const state = getState();
    const selectedTab = state.session.openTabs.find(
      (tab) => tab.id === state.session.selectedTabId,
    );
    if (!selectedTab) {
      return;
    }
    const doc = state.documents.find((document) => document.id === selectedTab.documentId);
    if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
      return;
    }
    appState.closeTab(selectedTab.id);
    notify("Tab closed.");
  },
  "tab.moveToNewWindow": async ({ notify }) => {
    const transfer = appState.transferActiveTabOut();
    if (!transfer) {
      notify("No active tab to transfer.");
      return;
    }
    await createNewWindowWithTransfer(appState.getSnapshot(), transfer);
    notify("Transferred tab to new window.");
  },
  "tab.next": ({ getState }) => {
    const state = getState();
    const tabs = state.session.openTabs;
    const index = tabs.findIndex((tab) => tab.id === state.session.selectedTabId);
    if (index < 0 || tabs.length < 2) {
      return;
    }
    appState.selectTab(tabs[(index + 1) % tabs.length].id);
  },
  "tab.previous": ({ getState }) => {
    const state = getState();
    const tabs = state.session.openTabs;
    const index = tabs.findIndex((tab) => tab.id === state.session.selectedTabId);
    if (index < 0 || tabs.length < 2) {
      return;
    }
    appState.selectTab(tabs[(index - 1 + tabs.length) % tabs.length].id);
  },
  "edit.undo": ({ getEditorRunner }) => {
    getEditorRunner()?.undo();
  },
  "edit.redo": ({ getEditorRunner }) => {
    getEditorRunner()?.redo();
  },
  "edit.indent": ({ getEditorRunner }) => {
    getEditorRunner()?.indent();
  },
  "edit.outdent": ({ getEditorRunner }) => {
    getEditorRunner()?.outdent();
  },
  "edit.moveLineUp": ({ getEditorRunner }) => {
    getEditorRunner()?.moveLineUp();
  },
  "edit.moveLineDown": ({ getEditorRunner }) => {
    getEditorRunner()?.moveLineDown();
  },
  "edit.duplicateLine": ({ getEditorRunner }) => {
    getEditorRunner()?.duplicateLine();
  },
  "edit.joinLines": ({ getEditorRunner }) => {
    getEditorRunner()?.joinLines();
  },
  "view.toggleWrap": ({ getState, getEditorRunner, notify }) => {
    const nextWrap = !getState().editor.wrapLines;
    appState.toggleWrap();
    getEditorRunner()?.setWrap(nextWrap);
    notify(nextWrap ? "Wrap enabled." : "Wrap disabled.");
  },
  "view.zoomIn": ({ getState, getEditorRunner }) => {
    const next = Math.min(220, getState().editor.zoomPercent + 10);
    appState.setZoomPercent(next);
    getEditorRunner()?.setZoom(next);
  },
  "view.zoomOut": ({ getState, getEditorRunner }) => {
    const next = Math.max(60, getState().editor.zoomPercent - 10);
    appState.setZoomPercent(next);
    getEditorRunner()?.setZoom(next);
  },
  "view.zoomReset": ({ getEditorRunner }) => {
    appState.setZoomPercent(100);
    getEditorRunner()?.setZoom(100);
  },
};

let appMenuInitialized = false;

async function buildAppMenu(runCommand: (commandId: AppCommandId) => void): Promise<void> {
  if (appMenuInitialized) {
    return;
  }

  const openItem = await MenuItem.new({
    id: "cmd.file.open",
    text: "Open",
    accelerator: "CmdOrCtrl+O",
    action: () => runCommand("file.open"),
  });
  const newWindowItem = await MenuItem.new({
    id: "cmd.file.newWindow",
    text: "New Window",
    accelerator: "CmdOrCtrl+Shift+N",
    action: () => runCommand("app.newWindow"),
  });
  const moveTabItem = await MenuItem.new({
    id: "cmd.file.moveTab",
    text: "Move Tab To New Window",
    action: () => runCommand("tab.moveToNewWindow"),
  });
  const saveItem = await MenuItem.new({
    id: "cmd.file.save",
    text: "Save",
    accelerator: "CmdOrCtrl+S",
    action: () => runCommand("file.save"),
  });
  const saveAsItem = await MenuItem.new({
    id: "cmd.file.saveAs",
    text: "Save As",
    accelerator: "CmdOrCtrl+Shift+S",
    action: () => runCommand("file.saveAs"),
  });
  const saveAllItem = await MenuItem.new({
    id: "cmd.file.saveAll",
    text: "Save All",
    accelerator: "CmdOrCtrl+Alt+S",
    action: () => runCommand("file.saveAll"),
  });
  const renameItem = await MenuItem.new({
    id: "cmd.file.rename",
    text: "Rename",
    action: () => runCommand("file.rename"),
  });
  const closeItem = await MenuItem.new({
    id: "cmd.file.close",
    text: "Close",
    accelerator: "CmdOrCtrl+W",
    action: () => runCommand("tab.close"),
  });

  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      openItem,
      newWindowItem,
      moveTabItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      saveItem,
      saveAsItem,
      saveAllItem,
      renameItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      closeItem,
    ],
  });

  const undoItem = await MenuItem.new({
    id: "cmd.edit.undo",
    text: "Undo",
    accelerator: "CmdOrCtrl+Z",
    action: () => runCommand("edit.undo"),
  });
  const redoItem = await MenuItem.new({
    id: "cmd.edit.redo",
    text: "Redo",
    accelerator: "CmdOrCtrl+Shift+Z",
    action: () => runCommand("edit.redo"),
  });
  const findReplaceItem = await MenuItem.new({
    id: "cmd.edit.findReplace",
    text: "Find / Replace",
    accelerator: "CmdOrCtrl+F",
    action: () => runCommand("app.toggleFindReplace"),
  });
  const cutItem = await PredefinedMenuItem.new({ item: "Cut" });
  const copyItem = await PredefinedMenuItem.new({ item: "Copy" });
  const pasteItem = await PredefinedMenuItem.new({ item: "Paste" });
  const selectAllItem = await PredefinedMenuItem.new({ item: "SelectAll" });
  const goToItem = await MenuItem.new({
    id: "cmd.edit.goTo",
    text: "Go To Line",
    accelerator: "CmdOrCtrl+L",
    action: () => runCommand("app.toggleGoTo"),
  });
  const indentItem = await MenuItem.new({
    id: "cmd.edit.indent",
    text: "Indent",
    accelerator: "CmdOrCtrl+]",
    action: () => runCommand("edit.indent"),
  });
  const outdentItem = await MenuItem.new({
    id: "cmd.edit.outdent",
    text: "Outdent",
    accelerator: "CmdOrCtrl+[",
    action: () => runCommand("edit.outdent"),
  });
  const moveLineUpItem = await MenuItem.new({
    id: "cmd.edit.moveLineUp",
    text: "Move Line Up",
    accelerator: "Alt+Up",
    action: () => runCommand("edit.moveLineUp"),
  });
  const moveLineDownItem = await MenuItem.new({
    id: "cmd.edit.moveLineDown",
    text: "Move Line Down",
    accelerator: "Alt+Down",
    action: () => runCommand("edit.moveLineDown"),
  });
  const duplicateLineItem = await MenuItem.new({
    id: "cmd.edit.duplicateLine",
    text: "Duplicate Line",
    accelerator: "CmdOrCtrl+D",
    action: () => runCommand("edit.duplicateLine"),
  });
  const joinLinesItem = await MenuItem.new({
    id: "cmd.edit.joinLines",
    text: "Join Lines",
    accelerator: "CmdOrCtrl+J",
    action: () => runCommand("edit.joinLines"),
  });

  const editMenu = await Submenu.new({
    text: "Edit",
    items: [
      undoItem,
      redoItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      cutItem,
      copyItem,
      pasteItem,
      selectAllItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      findReplaceItem,
      goToItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      indentItem,
      outdentItem,
      moveLineUpItem,
      moveLineDownItem,
      duplicateLineItem,
      joinLinesItem,
    ],
  });

  const settingsItem = await MenuItem.new({
    id: "cmd.view.settings",
    text: "Toggle Settings Pane",
    accelerator: "CmdOrCtrl+,",
    action: () => runCommand("app.toggleSettingsPane"),
  });
  const themeItem = await MenuItem.new({
    id: "cmd.view.theme",
    text: "Toggle Theme",
    accelerator: "CmdOrCtrl+Shift+T",
    action: () => runCommand("view.toggleTheme"),
  });
  const accentItem = await MenuItem.new({
    id: "cmd.view.accent",
    text: "Cycle Accent",
    action: () => runCommand("view.cycleAccent"),
  });
  const diffItem = await MenuItem.new({
    id: "cmd.view.diff",
    text: "Toggle Diff Preview",
    accelerator: "CmdOrCtrl+Shift+D",
    action: () => runCommand("view.toggleDiffPreview"),
  });
  const wrapItem = await MenuItem.new({
    id: "cmd.view.wrap",
    text: "Toggle Wrap",
    accelerator: "CmdOrCtrl+Alt+Z",
    action: () => runCommand("view.toggleWrap"),
  });
  const zoomInItem = await MenuItem.new({
    id: "cmd.view.zoomIn",
    text: "Zoom In",
    accelerator: "CmdOrCtrl+=",
    action: () => runCommand("view.zoomIn"),
  });
  const zoomOutItem = await MenuItem.new({
    id: "cmd.view.zoomOut",
    text: "Zoom Out",
    accelerator: "CmdOrCtrl+-",
    action: () => runCommand("view.zoomOut"),
  });
  const zoomResetItem = await MenuItem.new({
    id: "cmd.view.zoomReset",
    text: "Reset Zoom",
    accelerator: "CmdOrCtrl+0",
    action: () => runCommand("view.zoomReset"),
  });

  const viewMenu = await Submenu.new({
    text: "View",
    items: [
      settingsItem,
      themeItem,
      accentItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      diffItem,
      wrapItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      zoomInItem,
      zoomOutItem,
      zoomResetItem,
    ],
  });

  const appSubmenu = await Submenu.new({
    text: "spec-ops",
    items: [
      await PredefinedMenuItem.new({
        item: {
          About: {
            name: "spec-ops",
          },
        },
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const appMenu = await Menu.new({
    items: [appSubmenu, fileMenu, editMenu, viewMenu],
  });
  await appMenu.setAsAppMenu();
  appMenuInitialized = true;
}

export function dispatchCommand(
  commandId: AppCommandId,
  context: CommandContext,
): void {
  const handler = handlers[commandId];
  if (!handler) {
    return;
  }

  void logDiagnostic({
    level: "info",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: `command dispatched: ${commandId}`,
    metadata: { commandId },
  });
  Promise.resolve(handler(context)).catch((error: unknown) => {
    const message = summarizeError(error);
    context.notify(`Command failed: ${message}`);
    const details = sanitizeErrorDetails(serializeUnknownError(error));
    void logDiagnostic({
      level: "error",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: `command failed: ${commandId} (${message})`,
      metadata: { commandId, reason: message, ...details },
    });
  });
}

export function dispatchMenuCommand(
  commandId: AppCommandId,
  context: CommandContext,
): void {
  dispatchCommand(commandId, context);
}

export async function initializeAppMenu(
  runCommand: (commandId: AppCommandId) => void,
): Promise<void> {
  await buildAppMenu(runCommand);
}

export function keymapCommandForEvent(event: KeyboardEvent): AppCommandId | null {
  const token = [
    event.metaKey ? "Meta" : event.ctrlKey ? "Ctrl" : "",
    event.shiftKey ? "Shift" : "",
    event.altKey ? "Alt" : "",
    event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase(),
  ]
    .filter(Boolean)
    .join("+");

  return (keyBindingsByPlatform[token] as AppCommandId | undefined) ?? null;
}

export function getActiveDocumentContent(): string {
  const state = getSnapshot();
  const activeTabId = state.session.selectedTabId;
  const activeTab = state.session.openTabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return "";
  }
  const activeDocument = state.documents.find(
    (documentState) => documentState.id === activeTab.documentId,
  );
  return activeDocument?.content ?? "";
}
