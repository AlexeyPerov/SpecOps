import type { DocumentState, TabState } from "../domain/contracts";
import { findTabOwner, getSessionTabs, isFileTab, tabDocumentId } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import {
  tabIdsToCloseOtherThan,
  tabIdsToCloseToRightOf,
} from "../state/appState/tabHelpers";
import { saveDocumentForClose, saveDocumentKeepingTab, type SaveDocumentDeps } from "./documentSave";
import { needsCloseConfirmation, promptUnsavedClose } from "./unsavedClosePrompt";

export type CloseTabFlowDeps = SaveDocumentDeps;

async function resolveCloseDirtyDocument(
  document: DocumentState,
  deps: CloseTabFlowDeps,
  saveDocument: (
    doc: DocumentState,
    saveDeps: CloseTabFlowDeps,
  ) => Promise<boolean> = saveDocumentForClose,
): Promise<boolean> {
  if (!needsCloseConfirmation(document)) {
    return true;
  }

  const action = await promptUnsavedClose(document);
  if (action === "cancel") {
    return false;
  }
  if (action === "discard") {
    return true;
  }
  return saveDocument(document, deps);
}

export async function closeTabWithUnsavedPrompt(
  tabId: string,
  deps: CloseTabFlowDeps,
  options?: { forceClose?: boolean },
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const session = getActiveSession(snapshot);
  const owner = findTabOwner(session.editorLayout, tabId);
  if (!owner) {
    return false;
  }
  const tab = owner.tab;

  if (isFileTab(tab)) {
    const documentId = tabDocumentId(tab);
    const document = documentId
      ? getActiveDocuments(snapshot).find((entry) => entry.id === documentId)
      : undefined;
    if (document) {
      const shouldClose = await resolveCloseDirtyDocument(document, deps);
      if (!shouldClose) {
        return false;
      }
    }
  }

  if (options?.forceClose ?? true) {
    appState.closeTabForce(tabId);
  } else {
    appState.closeTab(tabId);
  }
  return true;
}

export async function closeTabsWithUnsavedPrompt(
  tabIds: string[],
  deps: CloseTabFlowDeps,
  selectedTabIdAfter: string | null,
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const openTabs = getSessionTabs(getActiveSession(snapshot));

  for (const tabId of tabIds) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    if (!tab || !isFileTab(tab)) {
      continue;
    }
    const documentId = tabDocumentId(tab);
    const document = documentId
      ? getActiveDocuments(snapshot).find((entry) => entry.id === documentId)
      : undefined;
    if (!document) {
      continue;
    }
    const shouldClose = await resolveCloseDirtyDocument(document, deps);
    if (!shouldClose) {
      return false;
    }
  }

  appState.closeTabsByIds(tabIds, selectedTabIdAfter);
  return true;
}

export async function closeOtherTabsWithUnsavedPrompt(
  contextTabId: string,
  deps: CloseTabFlowDeps,
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const tabs = getSessionTabs(getActiveSession(snapshot));
  if (!tabs.some((tab) => tab.id === contextTabId)) {
    return false;
  }
  const tabIds = tabIdsToCloseOtherThan(tabs, contextTabId);
  return closeTabsWithUnsavedPrompt(tabIds, deps, contextTabId);
}

export async function closeTabsToRightWithUnsavedPrompt(
  contextTabId: string,
  deps: CloseTabFlowDeps,
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const tabIds = tabIdsToCloseToRightOf(getSessionTabs(getActiveSession(snapshot)), contextTabId);
  return closeTabsWithUnsavedPrompt(tabIds, deps, contextTabId);
}

export async function confirmDirtyTabBeforeTransfer(
  tab: TabState,
  deps: CloseTabFlowDeps,
): Promise<boolean> {
  if (!isFileTab(tab)) {
    return true;
  }
  const snapshot = appState.getSnapshot();
  const documentId = tabDocumentId(tab);
  const document = documentId
    ? getActiveDocuments(snapshot).find((entry) => entry.id === documentId)
    : undefined;
  if (!document) {
    return true;
  }
  return resolveCloseDirtyDocument(document, deps, saveDocumentKeepingTab);
}
