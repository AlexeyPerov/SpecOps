import { get } from "svelte/store";
import type { AppCommandId, AppDomainState, CommandDefinition } from "../domain/contracts";
import { tabDocumentId } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { logDiagnostic } from "../services/logging";
import type { EditorCommandRunner } from "../types/editor";
import {
  ensureWorkspaceReadAccess,
  openFileDialog,
  openFolderDialog,
  saveFile,
  saveFileAs,
} from "../services/fileSystem";
import { renameDocumentOnDisk } from "../services/documentRename";
import { untitledSaveDefaultPath } from "../services/untitledSavePath";
import { renameOpenFileRegistry } from "../services/openFileRegistry";
import { reloadActiveDocumentFromDisk } from "../services/externalFileChanges";
import { createNewWindowWithTransfer } from "../services/windowManager";
import { closeTabWithUnsavedPrompt } from "../services/closeTabFlow";
import { moveTabToNewWindow } from "../services/tabWindowTransfer";
import { takeQueuedOpenRecentPath } from "../services/appMenu";
import { openActivePath, describeOpenActivePathResult } from "../services/openActivePath";
import { collectOpenableFolderFiles } from "../services/folderOpenableFiles";
import {
  FOLDER_OPEN_MAX_FILES,
  formatOpenAllInFolderSummary,
  openAllInFolder,
} from "../services/openAllInFolder";
import { runWithRecentFilesBatch } from "../services/recentFilesSync";
import { dirname } from "@tauri-apps/api/path";
import { normalizePathSync } from "../services/diskFingerprint";
import {
  sanitizeErrorDetails,
  serializeUnknownError,
  summarizeError,
} from "./commandErrors";
import { openAndStoreFile } from "./openAndStoreFile";
import { isPathUnderRoot, runInNotepadContext } from "../services/workspacePaths";
import {
  expandPlatformKeymaps,
  mergeCommandDefinitionsWithOverrides,
  type CommandBindingOverrides,
} from "./commandBindings";

type CommandContext = {
  setThemePaneOpen: (next: boolean) => void;
  isThemePaneOpen: () => boolean;
  setSettingsDialogOpen: (next: boolean) => void;
  isSettingsDialogOpen: () => boolean;
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

export { expandPlatformKeymaps } from "./commandBindings";

export const commandDefinitions: CommandDefinition[] = [
  {
    id: "app.toggleThemePane",
    label: "Toggle Theme Pane",
    menuPath: "View/Theme Pane",
  },
  {
    id: "app.toggleSettings",
    label: "Settings",
    menuPath: "SpecOps/Settings",
    binding: { mac: "Cmd+,", windows: "Ctrl+," },
  },
  {
    id: "app.newWindow",
    label: "New Window",
    menuPath: "File/New Window",
    binding: { mac: "Cmd+Shift+N", windows: "Ctrl+Shift+N" },
  },
  {
    id: "view.cycleTheme",
    label: "Cycle Theme",
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
    id: "file.openRecent",
    label: "Open Recent File",
    menuPath: "Hidden/Open Recent File",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "file.clearRecentFiles",
    label: "Clear Recent Files",
    menuPath: "File/Open Recent/Clear Recent",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "file.openAllInFolder",
    label: "Open all in Folder",
    menuPath: "File/Open all in Folder",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "workspace.add",
    label: "Add Workspace",
    menuPath: "File/Add Workspace",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "workspace.close",
    label: "Close Workspace",
    menuPath: "Hidden/Close Workspace",
    binding: { mac: "none", windows: "none" },
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
    binding: { mac: "Cmd+Alt+S", windows: "Ctrl+Alt+S" },
  },
  {
    id: "file.saveAll",
    label: "Save All",
    menuPath: "File/Save All",
    binding: { mac: "Cmd+Shift+S", windows: "Ctrl+Shift+S" },
  },
  {
    id: "file.rename",
    label: "Rename",
    menuPath: "File/Rename",
    binding: { mac: "none", windows: "none" },
  },
  {
    id: "file.reloadFromDisk",
    label: "Reload from Disk",
    menuPath: "File/Reload from Disk",
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

let keyBindingsByPlatform = expandPlatformKeymaps(commandDefinitions);

export function setCommandBindingOverrides(overrides: CommandBindingOverrides): void {
  keyBindingsByPlatform = expandPlatformKeymaps(
    mergeCommandDefinitionsWithOverrides(commandDefinitions, overrides),
  );
}

export function resetCommandBindingOverrides(): void {
  setCommandBindingOverrides({});
}

const handlers: Record<AppCommandId, CommandHandler> = {
  "app.toggleThemePane": ({ isThemePaneOpen, setThemePaneOpen }) => {
    setThemePaneOpen(!isThemePaneOpen());
  },
  "app.toggleSettings": ({ isSettingsDialogOpen, setSettingsDialogOpen }) => {
    setSettingsDialogOpen(!isSettingsDialogOpen());
  },
  "app.newWindow": async ({ getState, notify }) => {
    const createdWindowId = await createNewWindowWithTransfer(getState(), null);
    if (createdWindowId) {
      notify("Opened new window.");
    } else {
      notify("Failed to open new window.");
    }
  },
  "view.cycleTheme": () => {
    appState.cycleTheme();
  },
  "app.toggleFindReplace": () => {
    appState.toggleFindReplace();
  },
  "app.toggleGoTo": () => {
    appState.toggleGoTo();
  },
  "view.toggleMarkdownPreview": ({ getState, notify }) => {
    const state = getState();
    if (state.editor.previewMode === "markdown") {
      appState.setPreviewMode("editor");
    }
    const selectedTab = getActiveSession(state).openTabs.find(
      (tab) => tab.id === getActiveSession(state).selectedTabId,
    );
    const activeDocumentId = tabDocumentId(selectedTab);
    const activeDocument = activeDocumentId
      ? getActiveDocuments(state).find((document) => document.id === activeDocumentId)
      : undefined;
    if (!activeDocument || activeDocument.language !== "markdown") {
      notify("Markdown preview is only available for markdown files.");
      return;
    }
    const currentMode = activeDocument.markdownViewMode ?? "edit";
    const nextMode = currentMode === "preview" ? "edit" : "preview";
    appState.setDocumentMarkdownViewMode(activeDocument.id, nextMode);
    notify(nextMode === "preview" ? "Markdown preview on." : "Markdown preview off.");
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
  "file.openRecent": async ({ notify, getWindowId }) =>
    runInNotepadContext(async () => {
      const path = takeQueuedOpenRecentPath();
      if (!path) {
        return;
      }
      const result = await openActivePath(path, getWindowId());
      notify(describeOpenActivePathResult(result));
    }),
  "file.clearRecentFiles": () => {
    appState.clearRecentFiles();
  },
  "file.openAllInFolder": async ({ getState, getWindowId, confirm, notify }) =>
    runInNotepadContext(async () => {
      const state = getState();
      const selectedTab = getActiveSession(state).openTabs.find(
        (tab) => tab.id === getActiveSession(state).selectedTabId,
      );
      const activeDocumentId = tabDocumentId(selectedTab);
      const activeDocument = activeDocumentId
        ? getActiveDocuments(state).find((document) => document.id === activeDocumentId)
        : undefined;

      let defaultPath: string | null = null;
      if (activeDocument?.filePath) {
        defaultPath = await dirname(activeDocument.filePath);
      }

      const folderPath = await openFolderDialog(defaultPath);
      if (!folderPath) {
        return;
      }

      const matchedPaths = await collectOpenableFolderFiles(folderPath);
      await logDiagnostic({
        level: "info",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "openAllInFolder: scanned folder",
        metadata: { folderPath, matchedCount: matchedPaths.length },
      });
      if (matchedPaths.length === 0) {
        notify("No openable files in folder.");
        return;
      }

      let pathsToOpen = matchedPaths;
      if (matchedPaths.length > FOLDER_OPEN_MAX_FILES) {
        const confirmed = confirm(
          `Found ${matchedPaths.length} openable files. Open the first ${FOLDER_OPEN_MAX_FILES} alphabetically?`,
        );
        if (!confirmed) {
          return;
        }
        pathsToOpen = matchedPaths.slice(0, FOLDER_OPEN_MAX_FILES);
      }

      await logDiagnostic({
        level: "info",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "openAllInFolder: opening files",
        metadata: { folderPath, pathsToOpen: pathsToOpen.length },
      });

      const summary = await runWithRecentFilesBatch(() => openAllInFolder(pathsToOpen, getWindowId()));
      await logDiagnostic({
        level: "info",
        source: "frontend",
        timestamp: new Date().toISOString(),
        message: "openAllInFolder: complete",
        metadata: { ...summary },
      });
      notify(formatOpenAllInFolderSummary(summary));
    }),
  "file.save": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selected = getActiveSession(state).openTabs.find(
      (tab) => tab.id === getActiveSession(state).selectedTabId,
    );
    if (!selected) {
      notify("No active tab to save.");
      return;
    }
    const selectedDocumentId = tabDocumentId(selected);
    if (!selectedDocumentId) {
      notify("No active file tab to save.");
      return;
    }
    const doc = getActiveDocuments(state).find((document) => document.id === selectedDocumentId);
    if (!doc) {
      return;
    }

    let targetPath = doc.filePath;
    const previousPath = doc.filePath;
    let fingerprint;
    if (!targetPath) {
      const saved = await saveFileAs(
        doc.content,
        await untitledSaveDefaultPath(doc.content, appState.getWorkspaceRoot()),
      );
      if (!saved) {
        return;
      }
      targetPath = saved.path;
      fingerprint = saved.fingerprint;
    } else {
      fingerprint = await saveFile({ path: targetPath, content: doc.content });
    }
    appState.markDocumentSaved(doc.id, targetPath, doc.content);
    appState.setDocumentDiskState(doc.id, { diskFingerprint: fingerprint, fileMissing: false });
    await renameOpenFileRegistry(previousPath, targetPath, getWindowId(), doc.id);
    notify(`Saved ${targetPath}`);
  },
  "file.saveAs": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selected = getActiveSession(state).openTabs.find(
      (tab) => tab.id === getActiveSession(state).selectedTabId,
    );
    if (!selected) {
      notify("No active tab to save.");
      return;
    }
    const selectedDocumentId = tabDocumentId(selected);
    if (!selectedDocumentId) {
      notify("No active file tab to save.");
      return;
    }
    const doc = getActiveDocuments(state).find((document) => document.id === selectedDocumentId);
    if (!doc) {
      return;
    }
    const activeWorkspaceRoot = appState.getWorkspaceRoot();
    const saveAsDefaultPath = doc.filePath
      ? activeWorkspaceRoot
      : await untitledSaveDefaultPath(doc.content, activeWorkspaceRoot);
    const saved = await saveFileAs(doc.content, saveAsDefaultPath);
    if (!saved) {
      return;
    }
    const savedOutsideWorkspace =
      activeWorkspaceRoot !== null && !isPathUnderRoot(saved.path, activeWorkspaceRoot);
    const previousPath = doc.filePath;
    const sourceTabId = selected.id;
    appState.markDocumentSaved(doc.id, saved.path, doc.content);
    if (savedOutsideWorkspace) {
      appState.closeTabForce(sourceTabId);
      appState.switchContext("notepad");
      appState.openTransferredTab({
        filePath: saved.path,
        content: doc.content,
        title: doc.title,
      });
    }
    appState.setDocumentDiskState(doc.id, {
      diskFingerprint: saved.fingerprint,
      fileMissing: false,
    });
    await renameOpenFileRegistry(previousPath, saved.path, getWindowId(), doc.id);
    notify(
      savedOutsideWorkspace
        ? `Saved as ${saved.path} and moved tab to Notepad.`
        : `Saved as ${saved.path}`,
    );
  },
  "file.saveAll": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    let saved = 0;
    for (const documentState of getActiveDocuments(state)) {
      if (!documentState.isDirty) {
        continue;
      }
      let targetPath = documentState.filePath;
      const previousPath = documentState.filePath;
      let fingerprint;
      if (!targetPath) {
        const saved = await saveFileAs(
          documentState.content,
          await untitledSaveDefaultPath(documentState.content, appState.getWorkspaceRoot()),
        );
        if (!saved) {
          continue;
        }
        targetPath = saved.path;
        fingerprint = saved.fingerprint;
      } else {
        fingerprint = await saveFile({ path: targetPath, content: documentState.content });
      }
      appState.markDocumentSaved(documentState.id, targetPath, documentState.content);
      appState.setDocumentDiskState(documentState.id, {
        diskFingerprint: fingerprint,
        fileMissing: false,
      });
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
    const selected = getActiveSession(state).openTabs.find(
      (tab) => tab.id === getActiveSession(state).selectedTabId,
    );
    if (!selected) {
      return;
    }
    const selectedDocumentId = tabDocumentId(selected);
    if (!selectedDocumentId) {
      notify("No active file tab to save.");
      return;
    }
    await renameDocumentOnDisk(selectedDocumentId, {
      windowId: getWindowId(),
      notify,
    });
  },
  "file.reloadFromDisk": async ({ getState, notify }) => {
    const state = getState();
    const selected = getActiveSession(state).openTabs.find(
      (tab) => tab.id === getActiveSession(state).selectedTabId,
    );
    if (!selected) {
      notify("No active tab to reload.");
      return;
    }
    const selectedDocumentId = tabDocumentId(selected);
    if (!selectedDocumentId) {
      notify("No active file tab to save.");
      return;
    }
    const doc = getActiveDocuments(state).find((document) => document.id === selectedDocumentId);
    if (!doc?.filePath) {
      notify("Save the document before reloading from disk.");
      return;
    }

    const result = await reloadActiveDocumentFromDisk();
    switch (result) {
      case "reloaded":
        notify(`Reloaded ${doc.filePath} from disk.`);
        break;
      case "kept":
        notify("Kept local version.");
        break;
      case "missing":
        notify("File is missing on disk.");
        break;
      case "unchanged":
        notify("File is already up to date.");
        break;
      default:
        break;
    }
  },
  "tab.close": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selectedTabId = getActiveSession(state).selectedTabId;
    if (!selectedTabId) {
      return;
    }
    const closed = await closeTabWithUnsavedPrompt(
      selectedTabId,
      { getWindowId, notify },
      { forceClose: false },
    );
    if (closed) {
      notify("Tab closed.");
    }
  },
  "tab.moveToNewWindow": async ({ notify, getState, getWindowId }) => {
    const selectedTabId = getActiveSession(getState()).selectedTabId;
    if (!selectedTabId) {
      notify("No active tab to transfer.");
      return;
    }
    const transferred = await moveTabToNewWindow({
      tabId: selectedTabId,
      sourceWindowId: getWindowId(),
      notify,
    });
    if (transferred) {
      notify("Transferred tab to new window.");
    }
  },
  "tab.next": ({ getState }) => {
    const state = getState();
    const tabs = getActiveSession(state).openTabs;
    const index = tabs.findIndex((tab) => tab.id === getActiveSession(state).selectedTabId);
    if (index < 0 || tabs.length < 2) {
      return;
    }
    appState.selectTab(tabs[(index + 1) % tabs.length].id);
  },
  "tab.previous": ({ getState }) => {
    const state = getState();
    const tabs = getActiveSession(state).openTabs;
    const index = tabs.findIndex((tab) => tab.id === getActiveSession(state).selectedTabId);
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
  "workspace.add": async ({ notify }) => {
    const selected = await openFolderDialog();
    if (!selected) {
      return;
    }
    const normalizedRoot = normalizePathSync(selected);
    const accessStatus = await ensureWorkspaceReadAccess(normalizedRoot);
    if (accessStatus === "blocked") {
      notify("Workspace path is inaccessible. Check permissions and try again.");
      return;
    }

    const workspaceId = appState.addWorkspace(normalizedRoot);
    if (!workspaceId) {
      notify("Workspace is already open.");
      return;
    }
    notify("Workspace added.");
  },
  "workspace.close": ({ notify }) => {
    const activeContext = appState.getActiveContext();
    if (activeContext.kind !== "workspace") {
      notify("No active workspace to close.");
      return;
    }
    const closed = appState.closeWorkspace(activeContext.id, {
      resolveAction: (dirtyDocuments) => {
        const fileCount = dirtyDocuments.length;
        const shouldSave = window.confirm(
          `Workspace has ${fileCount} unsaved file(s). Press OK to Save All, or Cancel for more options.`,
        );
        if (shouldSave) {
          return "save-all";
        }
        const shouldDiscard = window.confirm("Discard all unsaved changes and close workspace?");
        return shouldDiscard ? "discard-all" : "cancel";
      },
      saveAllDirtyDocuments: (dirtyDocuments) => {
        for (const documentState of dirtyDocuments) {
          if (!documentState.filePath) {
            continue;
          }
          appState.markDocumentSaved(documentState.id, documentState.filePath, documentState.content);
        }
      },
    });
    if (closed) {
      notify("Workspace closed.");
    }
  },
};

export function getRegisteredCommandIds(): AppCommandId[] {
  return Object.keys(handlers) as AppCommandId[];
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

export { initializeAppMenu, refreshOpenRecentMenu, shouldInitializeAppMenu } from "../services/appMenu";

export const EDITOR_GLOBAL_COMMANDS: ReadonlySet<AppCommandId> = new Set([
  "file.new",
  "file.save",
  "file.saveAs",
  "file.saveAll",
  "tab.close",
]);

export function isEditorGlobalCommand(commandId: AppCommandId): boolean {
  return EDITOR_GLOBAL_COMMANDS.has(commandId);
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
  const activeTabId = getActiveSession(state).selectedTabId;
  const activeTab = getActiveSession(state).openTabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return "";
  }
  const activeDocumentId = tabDocumentId(activeTab);
  const activeDocument = activeDocumentId
    ? getActiveDocuments(state).find((documentState) => documentState.id === activeDocumentId)
    : undefined;
  return activeDocument?.content ?? "";
}
