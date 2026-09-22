import type { AppDomainState, ContextId, TabState } from "../../domain/contracts";
import {
  allTabs,
  createFileTab,
  createSessionTab,
  createViewTab,
  findTabOwner,
  getSessionSelectedTabId,
  getSessionTabs,
  isFileTab,
  isSessionTab,
  isViewTab,
  normalizeTabState,
  reorderActivePaneTabs,
  setActivePaneTabs,
  tabDocumentId,
} from "../../domain/contracts";
import { findNextOpenSessionTabAfterClose } from "../../services/workspaceAgentSession";
import { getDocumentByIdMap } from "../../services/tabDocumentLookup";
import { isGitIntegrationEnabled } from "../../services/gitIntegrationSettings";
import {
  findDocumentByPath,
  findDocumentByPathInContext,
  findDocumentContext,
  getActiveDocuments,
  getActiveSession,
  nextDocAndTabIds,
  nextTabId,
  patchActiveContext,
  patchContextById,
} from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";
import { createDocumentContentSlice } from "./documentContentSlice";
import { closeTabForceById, closeTabInPaneForceOnContext, selectTabAcrossPanes } from "./closeTabInPane";
import { createTabTransferSlice } from "./tabTransferSlice";
import {
  canCreateFileTabs,
  closeTabsForce,
  closeTabsForceInContext,
  missingTabIdsToClose,
  promoteTransientTabInLayout,
  reopenTabForDocument,
  tabIdsToCloseOtherThan,
  tabIdsToCloseToLeftOf,
  tabIdsToCloseToRightOf,
} from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

/**
 * Confirm closing dirty tabs in one pass. Builds a normalized tab-id map and a
 * document-id map once (O(n)) instead of re-normalizing the whole tab array and
 * scanning every document per candidate tab (O(n²)).
 */
function confirmDirtyTabsInPane(
  snapshot: AppDomainState,
  paneTabs: readonly TabState[],
  tabIds: readonly string[],
  confirm: (message: string) => boolean,
): boolean {
  const tabById = new Map<string, TabState>();
  for (const rawTab of paneTabs) {
    const tab = normalizeTabState(rawTab);
    tabById.set(tab.id, tab);
  }
  const documentById = getDocumentByIdMap(getActiveDocuments(snapshot));
  for (const tabId of tabIds) {
    const tab = tabById.get(tabId);
    if (!tab || !isFileTab(tab)) {
      continue;
    }
    const doc = documentById.get(tab.documentId);
    if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
      return false;
    }
  }
  return true;
}

export function createDocumentTabsLifecycleSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
}) {
  const { update, getSnapshot } = deps;

  function closeTabForce(tabId: string): void {
    update((state) => closeTabForceById(state, tabId));
  }

  return {
    createTab() {
      update((state) => {
        if (!canCreateFileTabs(state)) {
          return state;
        }
        return patchActiveContext(state, (ctx) => {
          // New tabs are intentionally appended to the focused pane.
          const { docId: id, tabId } = nextDocAndTabIds();
          const newDocument = buildEmptyUnsavedDocument(id);
          const tabs = getSessionTabs(ctx.session);
          return {
            documents: [...ctx.documents, newDocument],
            session: {
              ...ctx.session,
              editorLayout: setActivePaneTabs(
                ctx.session.editorLayout,
                [...tabs, createFileTab(tabId, id, false, false)],
                tabId,
              ),
            },
          };
        });
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabAcrossPanes(state, tabId));
    },
    openOrFocusSessionTab(sessionId: string) {
      update((state) => {
        const existingTab = allTabs(getActiveSession(state).editorLayout)
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isSessionTab(tab) && tab.sessionId === sessionId);
        if (existingTab) {
          return selectTabAcrossPanes(state, existingTab.id);
        }
        const tabId = nextTabId();
        return patchActiveContext(state, (ctx) => {
          // New session tabs are intentionally appended to the focused pane.
          const tabs = getSessionTabs(ctx.session);
          return {
            ...ctx,
            session: {
              ...ctx.session,
              editorLayout: setActivePaneTabs(
                ctx.session.editorLayout,
                [...tabs, createSessionTab(tabId, sessionId)],
                tabId,
              ),
            },
          };
        });
      });
    },
    /**
     * Open (or focus) a singleton view tab — Settings, Themes, Workspace
     * Settings, Workspace Manager, or Version Control — in the active session's tab strip,
     * treating it like any other tab. When a view tab of the same `view`
     * already exists it is selected instead of duplicated. An optional `subTab`
     * carries a deep-link target (e.g. a settings section id) that is attached
     * to a freshly created tab.
     */
    openOrFocusViewTab(
      view: "settings" | "themes" | "workspace-settings" | "workspace-manager" | "version-control",
      subTab?: string,
    ) {
      update((state) => {
        if (
          view === "version-control" &&
          !isGitIntegrationEnabled(state.settings.gitIntegration)
        ) {
          return state;
        }
        const existingTab = allTabs(getActiveSession(state).editorLayout)
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isViewTab(tab) && tab.view === view);
        if (existingTab) {
          return selectTabAcrossPanes(state, existingTab.id);
        }
        const tabId = nextTabId();
        return patchActiveContext(state, (ctx) => {
          // New view tabs are intentionally appended to the focused pane.
          const tabs = getSessionTabs(ctx.session);
          return {
            ...ctx,
            session: {
              ...ctx.session,
              editorLayout: setActivePaneTabs(
                ctx.session.editorLayout,
                [...tabs, createViewTab(tabId, view, false, subTab)],
                tabId,
              ),
            },
          };
        });
      });
    },
    closeTabsForSession(sessionId: string) {
      update((state) => {
        const tabIds = allTabs(getActiveSession(state).editorLayout)
          .map((rawTab) => normalizeTabState(rawTab))
          .filter((tab) => isSessionTab(tab) && tab.sessionId === sessionId)
          .map((tab) => tab.id);
        return closeTabsForce(state, tabIds, null);
      });
    },
    selectOrReopenTabForDocument(documentId: string) {
      update((state) => {
        const existingTab = allTabs(getActiveSession(state).editorLayout)
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isFileTab(tab) && tab.documentId === documentId);
        if (existingTab) {
          return selectTabAcrossPanes(state, existingTab.id);
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
    /**
     * Mark (or unmark) a file tab as transient. Transient tabs are the
     * single-click "preview" tabs opened from the project tree; see
     * {@link FileTabState.transient}. Only one per pane is expected, so
     * marking a tab transient clears the flag from its pane siblings.
     */
    setFileTabTransient(tabId: string, transient: boolean) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const owner = findTabOwner(ctx.session.editorLayout, tabId);
          if (!owner || !isFileTab(owner.tab)) {
            return ctx;
          }
          let changed = false;
          const panes = ctx.session.editorLayout.panes.map((pane) => {
            let paneChanged = false;
            const tabs = pane.tabs.map((tab) => {
              if (!isFileTab(tab)) {
                return tab;
              }
              // The target tab takes the requested value. When it becomes the
              // pane's preview, its pane siblings are cleared so a pane never
              // holds two; clearing a flag must not disturb any other tab
              // (promoting the outgoing preview would otherwise un-preview the
              // incoming one). Other panes always keep their own.
              const nextTransient =
                tab.id === tabId
                  ? transient
                  : transient && pane.id === owner.pane.id
                    ? false
                    : Boolean(tab.transient);
              if (Boolean(tab.transient) === nextTransient) {
                return tab;
              }
              paneChanged = true;
              const { transient: _previous, ...rest } = tab;
              return nextTransient ? { ...rest, transient: true as const } : rest;
            });
            if (!paneChanged) {
              return pane;
            }
            changed = true;
            return { ...pane, tabs };
          });
          if (!changed) {
            return ctx;
          }
          return {
            ...ctx,
            session: {
              ...ctx.session,
              editorLayout: { ...ctx.session.editorLayout, panes },
            },
          };
        }),
      );
    },
    /**
     * Clear the transient flag from the tab showing `documentId` — the
     * promotion path taken whenever the user acts on the file (edits it, moves
     * the caret, saves, renames, pins, drags the tab). Targets the context that
     * owns the document, which is not necessarily the active one (background
     * contexts stay mounted and can receive edits).
     */
    promoteTransientTabForDocument(documentId: string) {
      update((state) => {
        const owner = findDocumentContext(state, documentId);
        if (!owner) {
          return state;
        }
        return patchContextById(state, owner.contextId, (ctx) => {
          const nextLayout = promoteTransientTabInLayout(ctx.session.editorLayout, documentId);
          if (nextLayout === ctx.session.editorLayout) {
            return ctx;
          }
          return {
            ...ctx,
            session: { ...ctx.session, editorLayout: nextLayout },
          };
        });
      });
    },
    reorderTabs(fromIndex: number, toIndex: number) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const nextLayout = reorderActivePaneTabs(ctx.session.editorLayout, fromIndex, toIndex);
          if (nextLayout === ctx.session.editorLayout) {
            return ctx;
          }
          return {
            ...ctx,
            session: { ...ctx.session, editorLayout: nextLayout },
          };
        }),
      );
    },
    closeTab(tabId: string) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const owner = findTabOwner(ctx.session.editorLayout, tabId);
          if (!owner || owner.pane.tabs.length <= 1) {
            return ctx;
          }
          return closeTabInPaneForceOnContext(state, ctx, owner.pane.id, tabId);
        }),
      );
    },
    closeTabForce,
    closeTabWithPrompt(tabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const targetTab = allTabs(getActiveSession(snapshot).editorLayout).find((tab) => tab.id === tabId);
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
      const owner = findTabOwner(getActiveSession(snapshot).editorLayout, contextTabId);
      if (!owner) {
        return false;
      }
      const tabIds = tabIdsToCloseOtherThan(owner.pane.tabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }
      if (!confirmDirtyTabsInPane(snapshot, owner.pane.tabs, tabIds, confirm)) {
        return false;
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsToRight(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const owner = findTabOwner(getActiveSession(snapshot).editorLayout, contextTabId);
      if (!owner) {
        return false;
      }
      const tabIds = tabIdsToCloseToRightOf(owner.pane.tabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }
      if (!confirmDirtyTabsInPane(snapshot, owner.pane.tabs, tabIds, confirm)) {
        return false;
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsToLeft(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const owner = findTabOwner(getActiveSession(snapshot).editorLayout, contextTabId);
      if (!owner) {
        return false;
      }
      const tabIds = tabIdsToCloseToLeftOf(owner.pane.tabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }
      if (!confirmDirtyTabsInPane(snapshot, owner.pane.tabs, tabIds, confirm)) {
        return false;
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
    /**
     * Context-aware variant of {@link closeTabsByIds}. Required by callers that
     * locate a tab by searching every context — closing against the active
     * context silently does nothing when the tab lives elsewhere.
     */
    closeTabsByIdsInContext(
      contextId: ContextId,
      tabIds: string[],
      preferredTabId: string | null,
    ): void {
      if (tabIds.length === 0) {
        return;
      }
      update((state) => closeTabsForceInContext(state, contextId, tabIds, preferredTabId));
    },
    closeMissingFileTabs(): boolean {
      const snapshot = getSnapshot();
      const tabs = allTabs(getActiveSession(snapshot).editorLayout);
      const tabIds = missingTabIdsToClose(tabs, getActiveDocuments(snapshot));
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
