import { appState } from "../../state/appState";
import { createNewWindowWithTransfer } from "../../services/windowManager";
import { getSessionActiveTab, tabDocumentId } from "../../domain/contracts";
import { getActiveDocuments, getActiveSession } from "../../state/appState/contextHelpers";
import type { CommandHandlerMap } from "./types";

export const appHandlers: CommandHandlerMap = {
  "app.toggleThemePane": () => {
    appState.openOrFocusViewTab("themes");
  },
  "app.toggleSettings": () => {
    appState.openOrFocusViewTab("settings");
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
    const selectedTab = getSessionActiveTab(getActiveSession(state));
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
};
