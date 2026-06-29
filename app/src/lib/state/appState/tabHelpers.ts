import type { AppDomainState, DocumentState, TabState } from "../../domain/contracts";
import {
  createFileTab,
  getSessionTabs,
  isFileTab,
  normalizeTabState,
  recomputeSelectedTabId,
  setActivePaneTabs,
} from "../../domain/contracts";
import { isChatHttpContext, nextDocAndTabIds, nextTabId, patchActiveContext } from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";

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
  return patchActiveContext(state, (ctx) => {
    const tabs = getSessionTabs(ctx.session);
    if (!tabs.some((tab) => tab.id === tabId)) {
      return ctx;
    }
    const nextLayout = setActivePaneTabs(
      ctx.session.editorLayout,
      tabs,
      tabId,
    );
    if (nextLayout === ctx.session.editorLayout) {
      return ctx;
    }
    return {
      ...ctx,
      session: { ...ctx.session, editorLayout: nextLayout },
    };
  });
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
    const tabs = getSessionTabs(ctx.session);
    const filteredTabs = tabs.filter((tab) => !idsToClose.has(tab.id));
    if (filteredTabs.length === tabs.length) {
      return ctx;
    }
    if (filteredTabs.length === 0) {
      if (isChatHttpContext(state.contexts.activeContextId)) {
        return {
          ...ctx,
          session: {
            ...ctx.session,
            editorLayout: setActivePaneTabs(ctx.session.editorLayout, [], null),
          },
        };
      }
      const { docId, tabId } = nextDocAndTabIds();
      const newDocument = buildEmptyUnsavedDocument(docId);
      return {
        documents: [...ctx.documents, newDocument],
        session: {
          ...ctx.session,
          editorLayout: setActivePaneTabs(
            ctx.session.editorLayout,
            [createFileTab(tabId, docId)],
            tabId,
          ),
        },
      };
    }

    return {
      ...ctx,
      session: {
        ...ctx.session,
        editorLayout: setActivePaneTabs(
          ctx.session.editorLayout,
          filteredTabs,
          recomputeSelectedTabId(
            tabs,
            filteredTabs,
            ctx.session.editorLayout.panes.find(
              (pane) => pane.id === ctx.session.editorLayout.activePaneId,
            )?.selectedTabId ?? null,
            preferredTabId,
          ),
        ),
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
