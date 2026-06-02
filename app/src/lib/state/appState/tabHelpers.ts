import type { AppDomainState, DocumentState, TabState } from "../../domain/contracts";
import { createFileTab, isFileTab, normalizeTabState } from "../../domain/contracts";
import { nextDocAndTabIds, nextTabId, patchActiveContext } from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";

export function moveTab(tabs: TabState[], fromIndex: number, toIndex: number): TabState[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tabs.length ||
    toIndex >= tabs.length ||
    fromIndex === toIndex
  ) {
    return tabs;
  }
  const next = [...tabs];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) {
    return tabs;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

export function tabIdsToCloseOtherThan(
  openTabs: TabState[],
  contextTabId: string,
): string[] {
  return openTabs
    .filter((tab) => tab.id !== contextTabId && !tab.pinned)
    .map((tab) => tab.id);
}

export function tabIdsToCloseToRightOf(
  openTabs: TabState[],
  contextTabId: string,
): string[] {
  const contextIndex = openTabs.findIndex((tab) => tab.id === contextTabId);
  if (contextIndex < 0) {
    return [];
  }
  return openTabs
    .slice(contextIndex + 1)
    .filter((tab) => !tab.pinned)
    .map((tab) => tab.id);
}

export function missingTabIdsToClose(
  openTabs: TabState[],
  documents: DocumentState[],
): string[] {
  const missingByDocumentId = new Map(
    documents.map((documentState) => [documentState.id, documentState.fileMissing]),
  );
  return openTabs
    .map((rawTab) => normalizeTabState(rawTab))
    .filter(
      (tab) =>
        isFileTab(tab) && !tab.pinned && missingByDocumentId.get(tab.documentId) === true,
    )
    .map((tab) => tab.id);
}

export function nextSelectedTabAfterBulkClose(
  previousTabs: TabState[],
  remainingTabs: TabState[],
  previousSelectedTabId: string | null,
  preferredTabId: string | null = null,
): string | null {
  if (preferredTabId && remainingTabs.some((tab) => tab.id === preferredTabId)) {
    return preferredTabId;
  }
  if (!previousSelectedTabId) {
    return remainingTabs[0]?.id ?? null;
  }
  if (remainingTabs.some((tab) => tab.id === previousSelectedTabId)) {
    return previousSelectedTabId;
  }

  const selectedIndex = previousTabs.findIndex((tab) => tab.id === previousSelectedTabId);
  if (selectedIndex >= 0) {
    for (let idx = selectedIndex - 1; idx >= 0; idx -= 1) {
      const candidateId = previousTabs[idx]?.id;
      if (candidateId && remainingTabs.some((tab) => tab.id === candidateId)) {
        return candidateId;
      }
    }
  }
  return remainingTabs[0]?.id ?? null;
}

export function closeTabsForce(state: AppDomainState, tabIds: string[], preferredTabId: string | null): AppDomainState {
  if (tabIds.length === 0) {
    return state;
  }
  return patchActiveContext(state, (ctx) => {
    const idsToClose = new Set(tabIds);
    const filteredTabs = ctx.session.openTabs.filter((tab) => !idsToClose.has(tab.id));
    if (filteredTabs.length === ctx.session.openTabs.length) {
      return ctx;
    }
    if (filteredTabs.length === 0) {
      const { docId, tabId } = nextDocAndTabIds();
      const newDocument = buildEmptyUnsavedDocument(docId);
      return {
        documents: [...ctx.documents, newDocument],
        session: {
          ...ctx.session,
          openTabs: [createFileTab(tabId, docId)],
          selectedTabId: tabId,
        },
      };
    }

    return {
      ...ctx,
      session: {
        ...ctx.session,
        openTabs: filteredTabs,
        selectedTabId: nextSelectedTabAfterBulkClose(
          ctx.session.openTabs,
          filteredTabs,
          ctx.session.selectedTabId,
          preferredTabId,
        ),
      },
    };
  });
}
