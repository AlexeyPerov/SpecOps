import type { DocumentState, TabState } from "../domain/contracts";
import { allTabs, findTabOwner, isFileTab, tabDocumentId } from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import {
  tabIdsToCloseOtherThan,
  tabIdsToCloseToLeftOf,
  tabIdsToCloseToRightOf,
} from "../state/appState/tabHelpers";
import { clearDocumentExternalChangeState } from "./externalFileChanges";
import { saveDocumentForClose, saveDocumentKeepingTab, type SaveDocumentDeps } from "./documentSave";
import { needsCloseConfirmation, promptUnsavedClose } from "./unsavedClosePrompt";

export type CloseTabFlowDeps = SaveDocumentDeps;

/**
 * After closing tabs, drop external-change bookkeeping for any file document that
 * is no longer referenced by a tab anywhere in the active session. Keeps the
 * deferred-dirty / in-flight / self-write maps from retaining entries for closed
 * documents for the rest of the session (L20/L28).
 */
function pruneUnreferencedDocumentExternalChangeState(closedTabs: TabState[]): void {
  const closedFileDocs = new Map<string, string | null>();
  for (const tab of closedTabs) {
    if (isFileTab(tab)) {
      const docId = tabDocumentId(tab);
      if (docId && !closedFileDocs.has(docId)) {
        closedFileDocs.set(docId, null);
      }
    }
  }
  if (closedFileDocs.size === 0) {
    return;
  }
  const snapshot = appState.getSnapshot();
  const stillOpenDocIds = new Set<string>();
  for (const tab of allTabs(getActiveSession(snapshot).editorLayout)) {
    if (isFileTab(tab)) {
      const docId = tabDocumentId(tab);
      if (docId) {
        stillOpenDocIds.add(docId);
      }
    }
  }
  for (const docId of closedFileDocs.keys()) {
    if (stillOpenDocIds.has(docId)) {
      continue;
    }
    const doc = getActiveDocuments(snapshot).find((entry) => entry.id === docId);
    clearDocumentExternalChangeState(docId, doc?.filePath ?? undefined);
  }
}

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
    pruneUnreferencedDocumentExternalChangeState([tab]);
    return true;
  }
  appState.closeTab(tabId);
  pruneUnreferencedDocumentExternalChangeState([tab]);
  // `closeTab` intentionally no-ops when the pane has only one tab. Report
  // failure so callers do not claim success after a save-prompt that closed nothing.
  const stillOpen = findTabOwner(getActiveSession(appState.getSnapshot()).editorLayout, tabId);
  return stillOpen === null;
}

export async function closeTabsWithUnsavedPrompt(
  tabIds: string[],
  deps: CloseTabFlowDeps,
  selectedTabIdAfter: string | null,
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const openTabs = allTabs(getActiveSession(snapshot).editorLayout);

  const closingTabs: TabState[] = [];
  for (const tabId of tabIds) {
    const tab = openTabs.find((entry) => entry.id === tabId);
    if (!tab) {
      continue;
    }
    closingTabs.push(tab);
    if (!isFileTab(tab)) {
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
  pruneUnreferencedDocumentExternalChangeState(closingTabs);
  return true;
}

export async function closeOtherTabsWithUnsavedPrompt(
  contextTabId: string,
  deps: CloseTabFlowDeps,
  paneTabs?: TabState[],
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const owner = findTabOwner(getActiveSession(snapshot).editorLayout, contextTabId);
  if (!owner) {
    deps.notify("Tab is no longer available.");
    return false;
  }
  const tabs = paneTabs ?? owner.pane.tabs;
  if (!tabs.some((tab) => tab.id === contextTabId)) {
    deps.notify("Tab is no longer available.");
    return false;
  }
  const tabIds = tabIdsToCloseOtherThan(tabs, contextTabId);
  return closeTabsWithUnsavedPrompt(tabIds, deps, contextTabId);
}

export async function closeTabsToLeftWithUnsavedPrompt(
  contextTabId: string,
  deps: CloseTabFlowDeps,
  paneTabs?: TabState[],
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const owner = findTabOwner(getActiveSession(snapshot).editorLayout, contextTabId);
  if (!owner) {
    deps.notify("Tab is no longer available.");
    return false;
  }
  const tabs = paneTabs ?? owner.pane.tabs;
  if (!tabs.some((tab) => tab.id === contextTabId)) {
    deps.notify("Tab is no longer available.");
    return false;
  }
  const tabIds = tabIdsToCloseToLeftOf(tabs, contextTabId);
  return closeTabsWithUnsavedPrompt(tabIds, deps, contextTabId);
}

export async function closeTabsToRightWithUnsavedPrompt(
  contextTabId: string,
  deps: CloseTabFlowDeps,
  paneTabs?: TabState[],
): Promise<boolean> {
  const snapshot = appState.getSnapshot();
  const owner = findTabOwner(getActiveSession(snapshot).editorLayout, contextTabId);
  if (!owner) {
    deps.notify("Tab is no longer available.");
    return false;
  }
  const tabs = paneTabs ?? owner.pane.tabs;
  if (!tabs.some((tab) => tab.id === contextTabId)) {
    deps.notify("Tab is no longer available.");
    return false;
  }
  const tabIds = tabIdsToCloseToRightOf(tabs, contextTabId);
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
