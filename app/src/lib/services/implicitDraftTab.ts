import type { DocumentState, FileTabState, TabState } from "../domain/contracts";
import { createFileTab, isFileTab } from "../domain/contracts";
import { buildEmptyUnsavedDocument } from "../state/appState/documentHelpers";
import { isEmptyUnsavedDocument } from "./untitledDocument";

export interface ImplicitDraftPair {
  tab: FileTabState;
  document: DocumentState;
}

/** Creates a file tab + empty unsaved document pair for an implicit pane draft (strip hidden). */
export function createImplicitDraftPair(tabId: string, documentId: string): ImplicitDraftPair {
  return {
    tab: createFileTab(tabId, documentId, false, true),
    document: buildEmptyUnsavedDocument(documentId),
  };
}

/**
 * Whether a tab should appear in the pane tab strip.
 * File tabs with `stripHidden` stay hidden until the document has content.
 */
export function isTabVisibleInStrip(tab: TabState, document?: DocumentState): boolean {
  if (!isFileTab(tab)) {
    return true;
  }
  if (!tab.stripHidden) {
    return true;
  }
  if (!document) {
    return false;
  }
  return !isEmptyUnsavedDocument(document);
}

/** A lone empty unsitled draft that can be replaced by transfer/open-without-prompt flows. */
export function isReplaceableBootstrapTab(tab: TabState, document: DocumentState | undefined): boolean {
  if (!isFileTab(tab) || !document) {
    return false;
  }
  return isEmptyUnsavedDocument(document);
}

/** Clears `stripHidden` on a file tab (returns same ref when already visible). */
export function revealTabInStrip(tab: FileTabState): FileTabState {
  if (!tab.stripHidden) {
    return tab;
  }
  return { ...tab, stripHidden: false };
}
