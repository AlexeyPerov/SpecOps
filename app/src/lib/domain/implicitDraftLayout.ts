import type { DocumentState, EditorLayout, EditorPane } from "./contracts";
import { isFileTab } from "./document";

export interface EnsureImplicitDraftsResult {
  layout: EditorLayout;
  /** New documents to append to the context (empty when nothing was added). */
  newDocuments: DocumentState[];
}

export type NextDraftIds = () => { tabId: string; docId: string };

/**
 * Ensures every pane that supports file tabs has at least one tab. Empty panes
 * receive a single implicit draft (`stripHidden: true`) via `createDraftPair`.
 */
export function ensureImplicitDraftsInLayout(
  layout: EditorLayout,
  createDraft: NextDraftIds,
  createDraftPair: (tabId: string, documentId: string) => { tab: EditorPane["tabs"][number]; document: DocumentState },
): EnsureImplicitDraftsResult {
  const newDocuments: DocumentState[] = [];
  let changed = false;

  const panes = layout.panes.map((pane) => {
    if (pane.tabs.length > 0) {
      return pane;
    }
    const { tabId, docId } = createDraft();
    const { tab, document } = createDraftPair(tabId, docId);
    newDocuments.push(document);
    changed = true;
    return {
      ...pane,
      tabs: [tab],
      selectedTabId: tab.id,
    };
  });

  if (!changed) {
    return { layout, newDocuments: [] };
  }
  return { layout: { ...layout, panes }, newDocuments };
}

/** Clears `stripHidden` on every file tab bound to `documentId`. */
export function revealFileTabsInLayout(layout: EditorLayout, documentId: string): EditorLayout {
  let changed = false;
  const panes = layout.panes.map((pane) => {
    let paneChanged = false;
    const tabs = pane.tabs.map((tab) => {
      if (isFileTab(tab) && tab.documentId === documentId && tab.stripHidden) {
        paneChanged = true;
        changed = true;
        return { ...tab, stripHidden: false };
      }
      return tab;
    });
    if (!paneChanged) {
      return pane;
    }
    return { ...pane, tabs };
  });
  if (!changed) {
    return layout;
  }
  return { ...layout, panes };
}
