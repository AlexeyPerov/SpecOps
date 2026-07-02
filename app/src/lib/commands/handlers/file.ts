import { appState } from "../../state/appState";
import { CHAT_HTTP_CONTEXT_ID, getSessionActiveTab, tabDocumentId } from "../../domain/contracts";
import { getActiveSession } from "../../state/appState/contextHelpers";
import { openFileDialog } from "../../services/fileSystem";
import { renameDocumentOnDisk } from "../../services/documentRename";
import { takeQueuedOpenRecentPath } from "../../services/appMenu";
import { openActivePath, describeOpenActivePathResult } from "../../services/openActivePath";
import { logDiagnostic } from "../../services/logging";
import { sanitizeErrorDetails, serializeUnknownError, summarizeError } from "../commandErrors";
import { openAndStoreFile } from "../openAndStoreFile";
import { runOpenInActiveContext } from "../../services/fileContextPolicy";
import type { CommandHandlerMap } from "./types";
import {
  handleFileOpenAllInFolder,
  handleFileReloadFromDisk,
  handleFileSave,
  handleFileSaveAll,
  handleFileSaveAs,
  handleTabClose,
  handleTabMoveToNewWindow,
  handleTabNext,
  handleTabPrevious,
} from "./fileActions";

export const fileHandlers: CommandHandlerMap = {
  "file.new": ({ notify, getState }) => {
    if (getState().contexts.activeContextId === CHAT_HTTP_CONTEXT_ID) {
      notify("File tabs are unavailable in Chat.");
      return;
    }
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
    runOpenInActiveContext(async () => {
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
  "file.openAllInFolder": (context) => handleFileOpenAllInFolder(context),
  "file.save": (context) => handleFileSave(context),
  "file.saveAs": (context) => handleFileSaveAs(context),
  "file.saveAll": (context) => handleFileSaveAll(context),
  "file.rename": async ({ getState, notify, getWindowId }) => {
    const state = getState();
    const selected = getSessionActiveTab(getActiveSession(state));
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
  "file.reloadFromDisk": (context) => handleFileReloadFromDisk(context),
  "tab.close": (context) => handleTabClose(context),
  "tab.moveToNewWindow": (context) => handleTabMoveToNewWindow(context),
  "tab.next": (context) => handleTabNext(context),
  "tab.previous": (context) => handleTabPrevious(context),
};
