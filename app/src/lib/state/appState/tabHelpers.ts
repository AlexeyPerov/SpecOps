import type { AppDomainState, DocumentState, TabState } from "../../domain/contracts";
import {
  createFileTab,
  findTabOwner,
  getSessionTabs,
  isFileTab,
  normalizeTabState,
  recomputeSelectedTabId,
  setActivePaneTabs,
} from "../../domain/contracts";
import { isEmptyUnsavedDocument } from "../../services/untitledDocument";
import { createImplicitDraftPair } from "../../services/implicitDraftTab";
import { isChatHttpContext, nextDocAndTabIds, nextTabId, patchActiveContext } from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";
import { closeTabInPaneForceOnContext } from "./closeTabInPane";
import { selectTabAcrossPanes } from "./closeTabInPane";

export function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) {
    return items;
  }
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveTab(tabs: TabState[], fromIndex: number, toIndex: number): TabState[] {
  return moveArrayItem(tabs, fromIndex, toIndex);
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

export function canCreateFileTabs(state: AppDomainState): boolean {
  return !isChatHttpContext(state.contexts.activeContextId);
}

export function selectTabInternal(state: AppDomainState, tabId: string): AppDomainState {
  return selectTabAcrossPanes(state, tabId);
}

export function reopenTabForDocument(state: AppDomainState, documentId: string): AppDomainState {
  const tabId = nextTabId();
  return patchActiveContext(state, (ctx) => {
    const tabs = getSessionTabs(ctx.session);
    const nextTabs = [...tabs, createFileTab(tabId, documentId)];
    return {
      ...ctx,
      session: {
        ...ctx.session,
        editorLayout: setActivePaneTabs(ctx.session.editorLayout, nextTabs, tabId),
      },
    };
  });
}

export function closeTabsForce(state: AppDomainState, tabIds: string[], preferredTabId: string | null): AppDomainState {
  if (tabIds.length === 0) {
    return state;
  }
  return patchActiveContext(state, (ctx) => {
    const idsToClose = new Set(tabIds);
    const activePaneId = ctx.session.editorLayout.activePaneId;
    const pane = ctx.session.editorLayout.panes.find((entry) => entry.id === activePaneId);
    if (!pane) {
      return ctx;
    }
    const tabs = pane.tabs;
    const filteredTabs = tabs.filter((tab) => !idsToClose.has(tab.id));
    if (filteredTabs.length === tabs.length) {
      return ctx;
    }
    if (filteredTabs.length === 0) {
      return closeTabInPaneForceOnContext(state, ctx, activePaneId, tabs[0]?.id ?? tabIds[0]!);
    }

    return {
      ...ctx,
      session: {
        ...ctx.session,
        editorLayout: {
          ...ctx.session.editorLayout,
          panes: ctx.session.editorLayout.panes.map((entry) =>
            entry.id === activePaneId
              ? {
                  ...entry,
                  tabs: filteredTabs,
                  selectedTabId: recomputeSelectedTabId(
                    tabs,
                    filteredTabs,
                    entry.selectedTabId,
                    preferredTabId,
                  ),
                }
              : entry,
          ),
        },
      },
    };
  });
}

/**
 * @deprecated Use `recomputeSelectedTabId` from `domain/editorLayout` for new
 * code. Kept only for call sites that still pass the legacy signature.
 */
export function nextSelectedTabAfterBulkClose(
  previousTabs: TabState[],
  remainingTabs: TabState[],
  previousSelectedTabId: string | null,
  preferredTabId: string | null = null,
): string | null {
  return recomputeSelectedTabId(previousTabs, remainingTabs, previousSelectedTabId, preferredTabId);
}
