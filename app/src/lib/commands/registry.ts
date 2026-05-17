import { get } from "svelte/store";
import type { AppCommandId, AppDomainState, CommandDefinition } from "../domain/contracts";
import { appState } from "../state/appState";
import { logDiagnostic } from "../services/logging";
import type { EditorCommandRunner } from "../types/editor";
import { openFileDialog, renameFile, saveFile, saveFileAs } from "../services/fileSystem";
import { createNewWindowWithTransfer } from "../services/windowManager";

type CommandContext = {
  setSettingsPaneOpen: (next: boolean) => void;
  isSettingsPaneOpen: () => boolean;
  notify: (message: string) => void;
  getState: () => AppDomainState;
  confirm: (message: string) => boolean;
  getEditorRunner: () => EditorCommandRunner | null;
};

type CommandHandler = (context: CommandContext) => Promise<void> | void;

function getSnapshot() {
  return get(appState);
}

const keyBindingsByPlatform: Record<string, string> = {
  "Meta+,": "app.toggleSettingsPane",
  "Meta+Shift+t": "view.toggleTheme",
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
  "file.new": ({ notify }) => {
    appState.createTab();
    notify("New tab created.");
  },
  "file.open": async ({ notify }) => {
    const opened = await openFileDialog();
    if (!opened) {
      return;
    }
    appState.openFileInTab(opened.path, opened.content);
    notify(`Opened ${opened.path}`);
  },
  "file.save": async ({ getState, notify }) => {
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
    if (!targetPath) {
      targetPath = await saveFileAs(doc.content);
      if (!targetPath) {
        return;
      }
    } else {
      await saveFile({ path: targetPath, content: doc.content });
    }
    appState.markDocumentSaved(doc.id, targetPath, doc.content);
    notify(`Saved ${targetPath}`);
  },
  "file.saveAs": async ({ getState, notify }) => {
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
    appState.markDocumentSaved(doc.id, targetPath, doc.content);
    notify(`Saved as ${targetPath}`);
  },
  "file.saveAll": async ({ getState, notify }) => {
    const state = getState();
    let saved = 0;
    for (const documentState of state.documents) {
      if (!documentState.isDirty) {
        continue;
      }
      let targetPath = documentState.filePath;
      if (!targetPath) {
        targetPath = await saveFileAs(documentState.content);
        if (!targetPath) {
          continue;
        }
      } else {
        await saveFile({ path: targetPath, content: documentState.content });
      }
      appState.markDocumentSaved(documentState.id, targetPath, documentState.content);
      saved += 1;
    }
    notify(saved > 0 ? `Saved ${saved} document(s).` : "No dirty documents to save.");
  },
  "file.rename": async ({ getState, notify }) => {
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
    notify(`Renamed to ${title}`);
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
    const message =
      error instanceof Error ? error.message : "Unknown command error";
    context.notify(`Command failed: ${message}`);
    void logDiagnostic({
      level: "error",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: `command failed: ${commandId}`,
      metadata: { commandId, reason: message },
    });
  });
}

export function dispatchMenuCommand(
  commandId: AppCommandId,
  context: CommandContext,
): void {
  dispatchCommand(commandId, context);
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
