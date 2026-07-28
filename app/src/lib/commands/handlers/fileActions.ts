import { dirname } from "@tauri-apps/api/path";
import { appState } from "../../state/appState";
import {
  getSessionActiveTab,
  getSessionSelectedTabId,
  getSessionTabs,
  tabDocumentId,
} from "../../domain/contracts";
import {
  findDocumentContext,
  getActiveDocuments,
  getActiveSession,
} from "../../state/appState/contextHelpers";
import { applyDocumentSavedState, documentEncodeOptions } from "../../services/documentSave";
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
import { isFileContextRestricted, runOpenInActiveContext } from "../../services/fileContextPolicy";
import { isPathUnderRoot } from "../../services/workspacePaths";
import { handoffSavedFileToNotepad } from "../../services/savedFileHandoff";
import type { CommandContext } from "./types";

export async function handleFileOpenAllInFolder(context: CommandContext): Promise<void> {
  const { getState, getWindowId, confirm, notify } = context;
  await runOpenInActiveContext(async () => {
    const state = getState();
    const selectedTab = getSessionActiveTab(getActiveSession(state));
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
      const confirmed = await confirm(
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
  const selected = getSessionActiveTab(getActiveSession(state));
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
  // Snapshot the exact bytes handed to the writer so the post-write state records what
  // reached disk rather than whatever the buffer holds once the write resolves.
  const writtenContent = doc.content;
  const encodeOptions = documentEncodeOptions(doc);
  if (!targetPath) {
    const saved = await saveFileAs(
      writtenContent,
      await untitledSaveDefaultPath(writtenContent, appState.getWorkspaceRoot()),
      encodeOptions,
    );
    if (!saved) {
      return;
    }
    targetPath = saved.path;
    fingerprint = saved.fingerprint;
  } else {
    fingerprint = await saveFile({
      path: targetPath,
      content: writtenContent,
      ...encodeOptions,
    });
  }
  applyDocumentSavedState(doc.id, targetPath, writtenContent, fingerprint);
  await renameOpenFileRegistry(previousPath, targetPath, getWindowId(), doc.id);
  notify(`Saved ${targetPath}`);
}

export async function handleFileSaveAs(context: CommandContext): Promise<void> {
  const { getState, notify, getWindowId } = context;
  const state = getState();
  const selected = getSessionActiveTab(getActiveSession(state));
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
  const writtenContent = doc.content;
  const saveAsDefaultPath = doc.filePath
    ? activeWorkspaceRoot
    : await untitledSaveDefaultPath(writtenContent, activeWorkspaceRoot);
  const saved = await saveFileAs(writtenContent, saveAsDefaultPath, documentEncodeOptions(doc));
  if (!saved) {
    return;
  }
  const savedOutsideWorkspace =
    activeWorkspaceRoot !== null && !isPathUnderRoot(saved.path, activeWorkspaceRoot);
  const previousPath = doc.filePath;
  const sourceTabId = selected.id;
  if (savedOutsideWorkspace && isFileContextRestricted()) {
    await handoffSavedFileToNotepad({
      sourceTabId,
      sourceDocumentId: doc.id,
      previousPath,
      filePath: saved.path,
      content: writtenContent,
      title: doc.title,
      fingerprint: saved.fingerprint,
      windowId: getWindowId(),
    });
  } else {
    applyDocumentSavedState(doc.id, saved.path, writtenContent, saved.fingerprint);
    await renameOpenFileRegistry(previousPath, saved.path, getWindowId(), doc.id);
  }
  notify(
    savedOutsideWorkspace && isFileContextRestricted()
      ? `Saved as ${saved.path} and moved tab to Notepad.`
      : `Saved as ${saved.path}`,
  );
}

export async function handleFileSaveAll(context: CommandContext): Promise<void> {
  const { getState, notify, getWindowId } = context;
  const state = getState();
  let saved = 0;
  const failures: string[] = [];
  // Only the ids are taken from the initial snapshot. Each document is re-read from
  // current state at its turn, because every await in this loop (the dialog for
  // untitled files, each disk write, each registry update) is a window in which the
  // user can keep typing — and a Save All over many files makes that window long.
  // Per-document try/catch keeps one read-only or otherwise failing write from
  // aborting the rest (and from surfacing only a raw OS error as "Command failed").
  const documentIds = getActiveDocuments(state).map((documentState) => documentState.id);
  for (const documentId of documentIds) {
    const owner = findDocumentContext(appState.getSnapshot(), documentId);
    if (!owner) {
      continue;
    }
    const documentState = owner.document;
    if (!documentState.isDirty || documentState.contentKind !== "text") {
      continue;
    }
    try {
      let targetPath = documentState.filePath;
      const previousPath = documentState.filePath;
      const writtenContent = documentState.content;
      const encodeOptions = documentEncodeOptions(documentState);
      let fingerprint;
      if (!targetPath) {
        const savedAs = await saveFileAs(
          writtenContent,
          await untitledSaveDefaultPath(writtenContent, appState.getWorkspaceRoot()),
          encodeOptions,
        );
        if (!savedAs) {
          continue;
        }
        targetPath = savedAs.path;
        fingerprint = savedAs.fingerprint;
      } else {
        fingerprint = await saveFile({
          path: targetPath,
          content: writtenContent,
          ...encodeOptions,
        });
      }
      applyDocumentSavedState(documentState.id, targetPath, writtenContent, fingerprint);
      await renameOpenFileRegistry(
        previousPath,
        targetPath,
        getWindowId(),
        documentState.id,
      );
      saved += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(
        `"${documentState.title}"${message ? `: ${message}` : ""}`,
      );
    }
  }
  if (failures.length === 0) {
    notify(saved > 0 ? `Saved ${saved} document(s).` : "No dirty documents to save.");
    return;
  }
  const failureSummary = failures.join("; ");
  if (saved === 0) {
    notify(`Save All failed: ${failureSummary}`);
    return;
  }
  notify(`Saved ${saved} document(s). ${failures.length} failed: ${failureSummary}`);
}

export async function handleFileReloadFromDisk(context: CommandContext): Promise<void> {
  const { getState, notify } = context;
  const state = getState();
  const selected = getSessionActiveTab(getActiveSession(state));
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
  const selectedTabId = getSessionSelectedTabId(getActiveSession(state));
  if (!selectedTabId) {
    return;
  }
  // Match the tab × button: force-close so the last tab in a pane is replaced
  // with an untitled draft instead of prompting, no-oping, then reporting success.
  const closed = await closeTabWithUnsavedPrompt(selectedTabId, { getWindowId, notify });
  if (closed) {
    notify("Tab closed.");
  }
}

export async function handleTabMoveToNewWindow(context: CommandContext): Promise<void> {
  const { notify, getState, getWindowId } = context;
  const selectedTabId = getSessionSelectedTabId(getActiveSession(getState()));
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
  // Tab cycling is pane-local: keyboard navigation stays in the focused pane.
  const tabs = getSessionTabs(getActiveSession(state));
  const index = tabs.findIndex((tab) => tab.id === getSessionSelectedTabId(getActiveSession(state)));
  if (index < 0 || tabs.length < 2) {
    return;
  }
  appState.selectTab(tabs[(index + 1) % tabs.length].id);
}

export function handleTabPrevious(context: CommandContext): void {
  const state = context.getState();
  // Tab cycling is pane-local: keyboard navigation stays in the focused pane.
  const tabs = getSessionTabs(getActiveSession(state));
  const index = tabs.findIndex((tab) => tab.id === getSessionSelectedTabId(getActiveSession(state)));
  if (index < 0 || tabs.length < 2) {
    return;
  }
  appState.selectTab(tabs[(index - 1 + tabs.length) % tabs.length].id);
}
