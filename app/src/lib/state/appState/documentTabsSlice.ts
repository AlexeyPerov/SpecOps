import type { AppDomainState } from "../../domain/contracts";
import {
  createFileTab,
  createSessionTab,
  createViewTab,
  isFileTab,
  isSessionTab,
  isViewTab,
  normalizeTabState,
  tabDocumentId,
} from "../../domain/contracts";
import { findNextOpenSessionTabAfterClose } from "../../services/workspaceAgentSession";
import {
  findDocumentByPath,
  findDocumentByPathInContext,
  getActiveDocuments,
  getActiveSession,
  nextDocAndTabIds,
  nextTabId,
  patchActiveContext,
} from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";
import { createDocumentContentSlice } from "./documentContentSlice";
import { createTabTransferSlice } from "./tabTransferSlice";
import {
  canCreateFileTabs,
  closeTabsForce,
  missingTabIdsToClose,
  moveTab,
  reopenTabForDocument,
  selectTabInternal,
  tabIdsToCloseOtherThan,
  tabIdsToCloseToRightOf,
} from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

export function createDocumentTabsLifecycleSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
}) {
  const { update, getSnapshot } = deps;

  function closeTabForce(tabId: string): void {
    update((state) =>
      patchActiveContext(state, (ctx) => {
        const openTabs = ctx.session.openTabs;
        if (openTabs.length === 0) {
          return ctx;
        }
        const idx = openTabs.findIndex((tab) => tab.id === tabId);
        if (idx < 0) {
          return ctx;
        }
        const filtered = openTabs.filter((tab) => tab.id !== tabId);
        if (filtered.length === 0) {
          if (!canCreateFileTabs(state)) {
            return {
              ...ctx,
              session: {
                ...ctx.session,
                openTabs: [],
                selectedTabId: null,
                lastActiveSessionId: null,
              },
            };
          }
          const { docId, tabId: tabIdNew } = nextDocAndTabIds();
          const newDocument = buildEmptyUnsavedDocument(docId);
          return {
            documents: [...ctx.documents, newDocument],
            session: {
              ...ctx.session,
              openTabs: [createFileTab(tabIdNew, docId)],
              selectedTabId: tabIdNew,
              lastActiveSessionId: null,
            },
          };
        }
        const closingTab = openTabs[idx];
        let selectedTabId =
          ctx.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : ctx.session.selectedTabId;
        if (ctx.session.selectedTabId === tabId && isSessionTab(closingTab)) {
          const nextSessionTab = findNextOpenSessionTabAfterClose(openTabs, tabId);
          if (nextSessionTab) {
            selectedTabId = nextSessionTab.id;
          }
        }
        return {
          ...ctx,
          session: {
            ...ctx.session,
            openTabs: filtered,
            selectedTabId,
          },
        };
      }),
    );
  }

  return {
    createTab() {
      update((state) => {
        if (!canCreateFileTabs(state)) {
          return state;
        }
        return patchActiveContext(state, (ctx) => {
          const { docId: id, tabId } = nextDocAndTabIds();
          const newDocument = buildEmptyUnsavedDocument(id);
          return {
            documents: [...ctx.documents, newDocument],
            session: {
              ...ctx.session,
              openTabs: [...ctx.session.openTabs, createFileTab(tabId, id)],
              selectedTabId: tabId,
            },
          };
        });
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    openOrFocusSessionTab(sessionId: string) {
      update((state) => {
        const existingTab = getActiveSession(state).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isSessionTab(tab) && tab.sessionId === sessionId);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        const tabId = nextTabId();
        return patchActiveContext(state, (ctx) => ({
          ...ctx,
          session: {
            ...ctx.session,
            openTabs: [...ctx.session.openTabs, createSessionTab(tabId, sessionId)],
            selectedTabId: tabId,
          },
        }));
      });
    },
    /**
     * Open (or focus) a singleton view tab — Settings or Themes — in the
     * active session's tab strip, treating it like any other tab. When a view
     * tab of the same `view` already exists it is selected instead of
     * duplicated. An optional `subTab` carries a deep-link target (e.g. a
     * settings section id) that is attached to a freshly created tab.
     */
    openOrFocusViewTab(view: "settings" | "themes", subTab?: string) {
      update((state) => {
        const existingTab = getActiveSession(state).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isViewTab(tab) && tab.view === view);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        const tabId = nextTabId();
        return patchActiveContext(state, (ctx) => ({
          ...ctx,
          session: {
            ...ctx.session,
            openTabs: [...ctx.session.openTabs, createViewTab(tabId, view, false, subTab)],
            selectedTabId: tabId,
          },
        }));
      });
    },
    closeTabsForSession(sessionId: string) {
      update((state) => {
        const tabIds = getActiveSession(state).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .filter((tab) => isSessionTab(tab) && tab.sessionId === sessionId)
          .map((tab) => tab.id);
        return closeTabsForce(state, tabIds, null);
      });
    },
    selectOrReopenTabForDocument(documentId: string) {
      update((state) => {
        const existingTab = getActiveSession(state).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isFileTab(tab) && tab.documentId === documentId);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        if (!canCreateFileTabs(state)) {
          return state;
        }
        return reopenTabForDocument(state, documentId);
      });
    },
    findDocumentIdByPath(filePath: string): string | null {
      const snapshot = getSnapshot();
      const inActive = findDocumentByPath(snapshot, filePath);
      if (inActive) {
        return inActive.id;
      }
      const inNotepad = findDocumentByPathInContext(snapshot.contexts.notepad, filePath);
      if (inNotepad) {
        return inNotepad.id;
      }
      for (const workspace of snapshot.contexts.workspaces) {
        const inWorkspace = findDocumentByPathInContext(workspace.snapshot, filePath);
        if (inWorkspace) {
          return inWorkspace.id;
        }
      }
      return null;
    },
    reorderTabs(fromIndex: number, toIndex: number) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const openTabs = moveTab(ctx.session.openTabs, fromIndex, toIndex);
          if (openTabs === ctx.session.openTabs) {
            return ctx;
          }
          return {
            ...ctx,
            session: {
              ...ctx.session,
              openTabs,
            },
          };
        }),
      );
    },
    closeTab(tabId: string) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const openTabs = ctx.session.openTabs;
          if (openTabs.length <= 1) {
            return ctx;
          }
          const idx = openTabs.findIndex((tab) => tab.id === tabId);
          if (idx < 0) {
            return ctx;
          }
          const filtered = openTabs.filter((tab) => tab.id !== tabId);
          const closingTab = openTabs[idx];
          let selectedTabId =
            ctx.session.selectedTabId === tabId
              ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
              : ctx.session.selectedTabId;
          if (ctx.session.selectedTabId === tabId && isSessionTab(closingTab)) {
            const nextSessionTab = findNextOpenSessionTabAfterClose(openTabs, tabId);
            if (nextSessionTab) {
              selectedTabId = nextSessionTab.id;
            }
          }
          return {
            ...ctx,
            session: {
              ...ctx.session,
              openTabs: filtered,
              selectedTabId,
            },
          };
        }),
      );
    },
    closeTabForce,
    closeTabWithPrompt(tabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const targetTab = getActiveSession(snapshot).openTabs.find((tab) => tab.id === tabId);
      if (!targetTab) {
        return false;
      }
      const targetDocumentId = tabDocumentId(targetTab);
      const targetDocument = targetDocumentId
        ? getActiveDocuments(snapshot).find((documentState) => documentState.id === targetDocumentId)
        : undefined;
      if (targetDocument?.isDirty && !confirm(`Close ${targetDocument.title} without saving?`)) {
        return false;
      }
      closeTabForce(tabId);
      return true;
    },
    closeOtherTabs(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      if (!getActiveSession(snapshot).openTabs.some((tab) => tab.id === contextTabId)) {
        return false;
      }
      const tabIds = tabIdsToCloseOtherThan(getActiveSession(snapshot).openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = getActiveSession(snapshot).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
          continue;
        }
        const doc = getActiveDocuments(snapshot).find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsToRight(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const tabIds = tabIdsToCloseToRightOf(getActiveSession(snapshot).openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = getActiveSession(snapshot).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
          continue;
        }
        const doc = getActiveDocuments(snapshot).find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsByIds(tabIds: string[], preferredTabId: string | null): void {
      if (tabIds.length === 0) {
        return;
      }
      update((state) => closeTabsForce(state, tabIds, preferredTabId));
    },
    closeMissingFileTabs(): boolean {
      const snapshot = getSnapshot();
      const tabIds = missingTabIdsToClose(getActiveSession(snapshot).openTabs, getActiveDocuments(snapshot));
      if (tabIds.length === 0) {
        return false;
      }

      update((state) => closeTabsForce(state, tabIds, null));
      return true;
    },
  };
}

export function createDocumentTabsSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
}) {
  const lifecycle = createDocumentTabsLifecycleSlice(deps);
  const content = createDocumentContentSlice(deps);
  const transfer = createTabTransferSlice({
    ...deps,
    closeTabForce: lifecycle.closeTabForce,
  });
  return { ...lifecycle, ...content, ...transfer };
}
