import {
  allTabs,
  findTabOwner,
  getSessionSelectedTabId,
  getSessionTabs,
  isFileTab,
  type DocumentState,
  type FileTabState,
} from "../domain/contracts";
import { appState } from "../state/appState";
import { getActiveDocuments, getActiveSession } from "../state/appState/contextHelpers";
import { clearDocumentExternalChangeState } from "./externalFileChanges";

/**
 * Transient ("preview") tabs — the single-click tabs opened from the project
 * tree. One per pane: opening another file the same way reuses the slot and
 * closes the previous preview, so browsing a tree does not leave a trail of
 * tabs. A transient tab is promoted to an ordinary tab the moment the user does
 * something with the file (see `promoteTransientTab*` callers).
 *
 * A preview tab is never closed out from under unsaved work or a pin: such a
 * tab is promoted instead, and the new file opens in a fresh preview slot.
 */

export interface TransientTabSnapshot {
  tabId: string;
  documentId: string;
  /** Index of the tab within its pane, so the replacement lands in place. */
  index: number;
  filePath: string | null;
  /** True when the tab must be kept (unsaved edits or pinned) instead of replaced. */
  keep: boolean;
}

function documentForTab(
  tab: FileTabState,
  documents: readonly DocumentState[],
): DocumentState | undefined {
  return documents.find((entry) => entry.id === tab.documentId);
}

/**
 * The active pane's current transient tab, captured before a new file is
 * opened. Returns null when the pane has none.
 */
export function captureActivePaneTransientTab(): TransientTabSnapshot | null {
  const snapshot = appState.getSnapshot();
  const session = getActiveSession(snapshot);
  const tabs = getSessionTabs(session);
  const index = tabs.findIndex((tab) => isFileTab(tab) && tab.transient === true);
  if (index < 0) {
    return null;
  }
  const tab = tabs[index] as FileTabState;
  const document = documentForTab(tab, getActiveDocuments(snapshot));
  return {
    tabId: tab.id,
    documentId: tab.documentId,
    index,
    filePath: document?.filePath ?? null,
    keep: tab.pinned === true || document?.isDirty === true,
  };
}

/**
 * Finish a transient open: mark the freshly opened tab as the pane's preview
 * tab and retire the previous one.
 *
 * `previous` is the snapshot taken by {@link captureActivePaneTransientTab}
 * before the open. When it is still present and replaceable it is closed and
 * the new tab takes its place in the strip; when it must be kept (dirty or
 * pinned) it is simply promoted and the new preview is appended.
 */
export function completeTransientOpen(
  openedDocumentId: string,
  previous: TransientTabSnapshot | null,
): void {
  const snapshot = appState.getSnapshot();
  const session = getActiveSession(snapshot);
  const openedTab = allTabs(session.editorLayout).find(
    (tab) => isFileTab(tab) && tab.documentId === openedDocumentId,
  );
  if (!openedTab) {
    return;
  }
  // Only the tab that actually got focus becomes the preview; an open that
  // landed somewhere else (a redirect, a steal) is left alone.
  if (getSessionSelectedTabId(session) !== openedTab.id) {
    return;
  }
  appState.setFileTabTransient(openedTab.id, true);

  if (!previous || previous.tabId === openedTab.id || previous.documentId === openedDocumentId) {
    return;
  }
  const owner = findTabOwner(getActiveSession(appState.getSnapshot()).editorLayout, previous.tabId);
  if (!owner) {
    return;
  }
  if (previous.keep) {
    // Unsaved or pinned: keep the tab, drop only its preview status.
    appState.setFileTabTransient(previous.tabId, false);
    return;
  }
  appState.closeTabForce(previous.tabId);
  clearDocumentExternalChangeState(previous.documentId, previous.filePath ?? undefined);
  moveTabToIndex(openedTab.id, previous.index);
}

/**
 * Put the new preview tab where the replaced one was, so a run of single
 * clicks keeps the strip stable instead of walking the tab rightwards.
 */
function moveTabToIndex(tabId: string, index: number): void {
  const tabs = getSessionTabs(getActiveSession(appState.getSnapshot()));
  const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex < 0) {
    return;
  }
  const toIndex = Math.max(0, Math.min(index, tabs.length - 1));
  if (fromIndex === toIndex) {
    return;
  }
  appState.reorderTabs(fromIndex, toIndex);
}

/**
 * Promote the tab showing `documentId` out of preview state. Safe to call for
 * documents with no transient tab (the common case) — it is a no-op then.
 */
export function promoteTransientTabForDocument(documentId: string | null | undefined): void {
  if (!documentId) {
    return;
  }
  appState.promoteTransientTabForDocument(documentId);
}

/** Promote a tab by tab id (tab drag, double click, pin, context actions). */
export function promoteTransientTab(tabId: string | null | undefined): void {
  if (!tabId) {
    return;
  }
  appState.setFileTabTransient(tabId, false);
}
