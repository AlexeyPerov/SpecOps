import { dirname } from "@tauri-apps/api/path";
import { appState } from "../../state/appState";
import { tabDocumentId } from "../../domain/contracts";
import { getActiveDocuments, getActiveSession } from "../../state/appState/contextHelpers";
import { openFolderDialog, saveFile, saveFileAs } from "../../services/fileSystem";
import { untitledSaveDefaultPath } from "../../services/untitledSavePath";
import { renameOpenFileRegistry } from "../../services/openFileRegistry";
import { reloadActiveDocumentFromDisk } from "../../services/externalFileChanges";
import { closeTabWithUnsavedPrompt } from "../../services/closeTabFlow";
import { moveTabToNewWindow } from "../../services/tabWindowTransfer";
import { collectOpenableFolderFiles } from "../../services/folderOpenableFiles";
import {
  FOLDER_OPEN_MAX_FILES,
  formatOpenAllInFolderSummary,
  openAllInFolder,
} from "../../services/openAllInFolder";
import { runWithRecentFilesBatch } from "../../services/recentFilesSync";
import { logDiagnostic } from "../../services/logging";
import { isPathUnderRoot, runInNotepadContext } from "../../services/workspacePaths";
import type { CommandContext } from "./types";

export async function handleFileOpenAllInFolder(context: CommandContext): Promise<void> {
  const { getState, getWindowId, confirm, notify } = context;
  await runInNotepadContext(async () => {
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
  });
}

export async function handleFileSave(context: CommandContext): Promise<void> {
  const { getState, notify, getWindowId } = context;
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
  if (doc.contentKind !== "text") {
    notify("This file is not editable in the text editor.");
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
}

export async function handleFileSaveAs(context: CommandContext): Promise<void> {
  const { getState, notify, getWindowId } = context;
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
  if (doc.contentKind !== "text") {
    notify("This file is not editable in the text editor.");
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
}

export async function handleFileSaveAll(context: CommandContext): Promise<void> {
  const { getState, notify, getWindowId } = context;
  const state = getState();
  let saved = 0;
  for (const documentState of getActiveDocuments(state)) {
    if (!documentState.isDirty || documentState.contentKind !== "text") {
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
}

export async function handleFileReloadFromDisk(context: CommandContext): Promise<void> {
  const { getState, notify } = context;
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
}

export async function handleTabClose(context: CommandContext): Promise<void> {
  const { getState, notify, getWindowId } = context;
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
}

export async function handleTabMoveToNewWindow(context: CommandContext): Promise<void> {
  const { notify, getState, getWindowId } = context;
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
}

export function handleTabNext(context: CommandContext): void {
  const state = context.getState();
  const tabs = getActiveSession(state).openTabs;
  const index = tabs.findIndex((tab) => tab.id === getActiveSession(state).selectedTabId);
  if (index < 0 || tabs.length < 2) {
    return;
  }
  appState.selectTab(tabs[(index + 1) % tabs.length].id);
}

export function handleTabPrevious(context: CommandContext): void {
  const state = context.getState();
  const tabs = getActiveSession(state).openTabs;
  const index = tabs.findIndex((tab) => tab.id === getActiveSession(state).selectedTabId);
  if (index < 0 || tabs.length < 2) {
    return;
  }
  appState.selectTab(tabs[(index - 1 + tabs.length) % tabs.length].id);
}
