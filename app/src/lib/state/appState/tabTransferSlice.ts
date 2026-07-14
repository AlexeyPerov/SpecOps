import type { AppDomainState, ContextId, ContextSnapshot } from "../../domain/contracts";
import {
  allTabs,
  createFileTab,
  findTabOwner,
  getSessionTabs,
  isFileTab,
  recomputeSelectedTabId,
  setActivePaneTabs,
  tabDocumentId,
} from "../../domain/contracts";
import { createImplicitDraftPair, isReplaceableBootstrapTab } from "../../services/implicitDraftTab";
import { isPathUnderRoot } from "../../services/workspacePaths";
import {
  findDocumentByPath,
  findDocumentByPathInContext,
  findFileTabForNormalizedPath,
  getActiveContextSnapshot,
  getActiveDocuments,
  getActiveSession,
  nextDocAndTabIds,
  nextTabId,
  patchActiveContext,
} from "./contextHelpers";
import { buildDocument } from "./documentHelpers";
import { canCreateFileTabs, reopenTabForDocument, selectTabInternal } from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

function activePaneSelectedTabId(snapshot: ContextSnapshot): string | null {
  const layout = snapshot.session.editorLayout;
  return layout.panes.find((pane) => pane.id === layout.activePaneId)?.selectedTabId ?? null;
}

function removeFileTabFromSnapshot(
  snapshot: ContextSnapshot,
  tabId: string,
  documentId: string,
  lastActiveWindowId: string,
): ContextSnapshot {
  const owner = findTabOwner(snapshot.session.editorLayout, tabId);
  if (!owner) {
    return snapshot;
  }
  const filtered = owner.pane.tabs.filter((tab) => tab.id !== tabId);
  const remainingTabs = allTabs(snapshot.session.editorLayout).filter((tab) => tab.id !== tabId);
  const documents = snapshot.documents.filter((doc) => {
    if (doc.id !== documentId) {
      return true;
    }
    return remainingTabs.some((tab) => isFileTab(tab) && tab.documentId === documentId);
  });
  if (remainingTabs.length === 0) {
    const { tabId: draftTabId, docId: draftDocId } = nextDocAndTabIds();
    const { tab, document: draftDoc } = createImplicitDraftPair(draftTabId, draftDocId);
    return {
      ...snapshot,
      documents: [...documents, draftDoc],
      session: {
        ...snapshot.session,
        editorLayout: {
          ...snapshot.session.editorLayout,
          panes: snapshot.session.editorLayout.panes.map((pane) =>
            pane.id === owner.pane.id ? { ...pane, tabs: [tab], selectedTabId: tab.id } : pane,
          ),
        },
        lastActiveSessionId: null,
        lastActiveWindowId,
      },
    };
  }
  const selectedTabId = recomputeSelectedTabId(
    owner.pane.tabs,
    filtered,
    owner.pane.selectedTabId,
  );
  return {
    ...snapshot,
    documents,
    session: {
      ...snapshot.session,
      editorLayout: {
        ...snapshot.session.editorLayout,
        panes: snapshot.session.editorLayout.panes.map((pane) =>
          pane.id === owner.pane.id ? { ...pane, tabs: filtered, selectedTabId } : pane,
        ),
      },
    },
  };
}

function addFileTabWithDocument(
  snapshot: ContextSnapshot,
  document: ContextSnapshot["documents"][number],
  tabId: string,
): ContextSnapshot {
  // Migration destinations intentionally add new tabs to their focused pane.
  const tabs = getSessionTabs(snapshot.session);
  const existingTab = tabs.find(
    (tab) => isFileTab(tab) && tab.documentId === document.id,
  );
  if (existingTab) {
    return {
      ...snapshot,
      session: {
        ...snapshot.session,
        editorLayout: setActivePaneTabs(snapshot.session.editorLayout, tabs, existingTab.id),
      },
    };
  }
  const hasDocument = snapshot.documents.some((doc) => doc.id === document.id);
  const nextTabs = [...tabs, createFileTab(tabId, document.id)];
  return {
    documents: hasDocument ? snapshot.documents : [...snapshot.documents, document],
    session: {
      ...snapshot.session,
      editorLayout: setActivePaneTabs(snapshot.session.editorLayout, nextTabs, tabId),
    },
  };
}

function isDefaultBootstrapWindow(state: AppDomainState): boolean {
  const ctx = getActiveContextSnapshot(state);
  // Bootstrap replacement is defined by the focused pane's initial draft.
  const tabs = getSessionTabs(ctx.session);
  if (tabs.length !== 1) {
    return false;
  }
  const tab = tabs[0];
  if (!isFileTab(tab)) {
    return false;
  }
  const documentState = ctx.documents.find((doc) => doc.id === tab.documentId);
  return isReplaceableBootstrapTab(tab, documentState);
}

export function createTabTransferSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
  closeTabForce: (tabId: string) => void;
}) {
  const { update, getSnapshot, closeTabForce } = deps;

  return {
    migrateNotepadFileTabToWorkspace(
      normalizedPath: string,
      workspaceContextId: ContextId,
    ): string | null {
      let migratedDocumentId: string | null = null;
      update((state) => {
        const workspace = state.contexts.workspaces.find((entry) => entry.id === workspaceContextId);
        if (!workspace) {
          return state;
        }
        if (!isPathUnderRoot(normalizedPath, workspace.rootPath)) {
          return state;
        }
        const notepadMatch = findFileTabForNormalizedPath(state.contexts.notepad, normalizedPath);
        if (!notepadMatch) {
          return state;
        }
        const existingInWorkspace = findDocumentByPathInContext(
          workspace.snapshot,
          normalizedPath,
        );
        if (existingInWorkspace) {
          migratedDocumentId = existingInWorkspace.id;
          const existingTab = allTabs(workspace.snapshot.session.editorLayout).find(
            (tab) => isFileTab(tab) && tab.documentId === existingInWorkspace.id,
          );
          const nextWorkspace = existingTab
            ? workspace.snapshot
            : addFileTabWithDocument(workspace.snapshot, existingInWorkspace, nextTabId());
          const nextState = {
            ...state,
            contexts: {
              ...state.contexts,
              activeContextId: workspaceContextId,
              notepad: removeFileTabFromSnapshot(
                state.contexts.notepad,
                notepadMatch.tabId,
                notepadMatch.documentId,
                state.contexts.notepad.session.lastActiveWindowId,
              ),
              workspaces: state.contexts.workspaces.map((entry) =>
                entry.id === workspaceContextId
                  ? {
                      ...entry,
                      snapshot: nextWorkspace,
                    }
                  : entry,
              ),
            },
            editor: {
              ...state.editor,
              previewMode: "editor" as const,
            },
          };
          return existingTab ? selectTabInternal(nextState, existingTab.id) : nextState;
        }

        migratedDocumentId = notepadMatch.documentId;
        const workspaceTabId = nextTabId();
        const lastActiveWindowId = state.contexts.notepad.session.lastActiveWindowId;
        const nextNotepad = removeFileTabFromSnapshot(
          state.contexts.notepad,
          notepadMatch.tabId,
          notepadMatch.documentId,
          lastActiveWindowId,
        );
        const nextWorkspace = addFileTabWithDocument(
          workspace.snapshot,
          notepadMatch.document,
          workspaceTabId,
        );
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: workspaceContextId,
            notepad: nextNotepad,
            workspaces: state.contexts.workspaces.map((entry) =>
              entry.id === workspaceContextId ? { ...entry, snapshot: nextWorkspace } : entry,
            ),
          },
          editor: {
            ...state.editor,
            previewMode: "editor",
          },
        };
      });
      return migratedDocumentId;
    },
    buildTabTransferPayload(
      tabId: string,
    ): { filePath: string | null; content: string; title: string } | null {
      const snapshot = getSnapshot();
      const tab = allTabs(getActiveSession(snapshot).editorLayout).find((entry) => entry.id === tabId);
      if (!tab) {
        return null;
      }
      const documentId = tabDocumentId(tab);
      const doc = documentId
        ? getActiveDocuments(snapshot).find((documentState) => documentState.id === documentId)
        : undefined;
      if (!doc) {
        return null;
      }
      return {
        filePath: doc.filePath,
        content: doc.content,
        title: doc.title,
      };
    },
    removeTransferredTab(tabId: string): void {
      closeTabForce(tabId);
    },
    transferActiveTabOut(): { filePath: string | null; content: string; title: string } | null {
      const snapshot = getSnapshot();
      const selectedTabId = activePaneSelectedTabId(getActiveContextSnapshot(snapshot));
      if (!selectedTabId) {
        return null;
      }
      // transferActiveTabOut is explicitly a focused-pane command.
      const tab = getSessionTabs(getActiveSession(snapshot)).find((entry) => entry.id === selectedTabId);
      if (!tab) {
        return null;
      }
      const documentId = tabDocumentId(tab);
      const doc = documentId
        ? getActiveDocuments(snapshot).find((documentState) => documentState.id === documentId)
        : undefined;
      if (!doc) {
        return null;
      }
      const payload = {
        filePath: doc.filePath,
        content: doc.content,
        title: doc.title,
      };
      closeTabForce(selectedTabId);
      return payload;
    },
    openTransferredTab(payload: {
      filePath: string | null;
      content: string;
      title: string;
    }): string | null {
      let documentId: string | null = null;
      update((state) => {
        if (!canCreateFileTabs(state)) {
          return state;
        }
        if (payload.filePath) {
          const duplicate = findDocumentByPath(state, payload.filePath);
          if (duplicate) {
            documentId = duplicate.id;
            const existingTab = allTabs(getActiveSession(state).editorLayout).find(
              (tab) => isFileTab(tab) && tab.documentId === duplicate.id,
            );
            if (existingTab) {
              return selectTabInternal(state, existingTab.id);
            }
            return reopenTabForDocument(state, duplicate.id);
          }
        }
        const { docId, tabId } = nextDocAndTabIds();
        documentId = docId;
        const newDoc = buildDocument(
          { id: docId, filePath: payload.filePath },
          payload.content,
          payload.title,
          "text",
          state.settings.defaultMarkdownViewMode,
        );
        if (isDefaultBootstrapWindow(state)) {
          return patchActiveContext(state, () => ({
            documents: [newDoc],
            session: {
              ...getActiveSession(state),
              editorLayout: setActivePaneTabs(
                getActiveSession(state).editorLayout,
                [createFileTab(tabId, docId)],
                tabId,
              ),
            },
          }));
        }
        return patchActiveContext(state, (ctx) => {
          // Incoming transfers are intentionally appended to the focused pane.
          const tabs = getSessionTabs(ctx.session);
          return {
            documents: [...ctx.documents, newDoc],
            session: {
              ...ctx.session,
              editorLayout: setActivePaneTabs(
                ctx.session.editorLayout,
                [...tabs, createFileTab(tabId, docId)],
                tabId,
              ),
            },
          };
        });
      });
      return documentId;
    },
  };
}
