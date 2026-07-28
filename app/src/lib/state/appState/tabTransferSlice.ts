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

/**
 * Identify the replaceable bootstrap draft of the active context, or null.
 *
 * Requires the draft to be the only tab in the **whole layout**, not just the only tab
 * in the focused pane. `seedImplicitDraftsInContext` puts an empty draft in every empty
 * pane, so in a split the focused pane can hold a replaceable draft while sibling panes
 * hold real file tabs. Treating that as "bootstrap window" let the replacement path
 * discard every document in the context — losing the unsaved buffers behind the sibling
 * panes' tabs and leaving those tabs pointing at documents that no longer existed.
 *
 * Because a single-tab layout means that tab is necessarily the focused pane's, the
 * caller can safely replace the focused pane's tab list wholesale.
 */
function findReplaceableBootstrapTab(
  state: AppDomainState,
): { tabId: string; documentId: string } | null {
  const ctx = getActiveContextSnapshot(state);
  const paneTabs = getSessionTabs(ctx.session);
  if (paneTabs.length !== 1 || allTabs(ctx.session.editorLayout).length !== 1) {
    return null;
  }
  const tab = paneTabs[0];
  if (!isFileTab(tab)) {
    return null;
  }
  const documentState = ctx.documents.find((doc) => doc.id === tab.documentId);
  if (!isReplaceableBootstrapTab(tab, documentState)) {
    return null;
  }
  return { tabId: tab.id, documentId: tab.documentId };
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
    ): { filePath: string | null; content: string; title: string; lineEnding?: "lf" | "crlf"; hasBom?: boolean } | null {
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
        // Carry the on-disk encoding so the first save in the target window
        // preserves line endings and BOM instead of rewriting as LF/no-BOM.
        lineEnding: doc.lineEnding,
        hasBom: doc.hasBom,
      };
    },
    removeTransferredTab(tabId: string): void {
      closeTabForce(tabId);
    },
    transferActiveTabOut(): { filePath: string | null; content: string; title: string; lineEnding?: "lf" | "crlf"; hasBom?: boolean } | null {
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
        lineEnding: doc.lineEnding,
        hasBom: doc.hasBom,
      };
      closeTabForce(selectedTabId);
      return payload;
    },
    openTransferredTab(payload: {
      filePath: string | null;
      content: string;
      title: string;
      lineEnding?: "lf" | "crlf";
      hasBom?: boolean;
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
          // Preserve the source document's line ending and BOM so the first
          // save in this window does not rewrite a CRLF / BOM'd file as LF.
          { lineEnding: payload.lineEnding, hasBom: payload.hasBom },
        );
        const bootstrap = findReplaceableBootstrapTab(state);
        if (bootstrap) {
          return patchActiveContext(state, (ctx) => ({
            // Drop only the bootstrap draft. Filtering rather than replacing the array
            // keeps any other document this context owns (e.g. one still held by a
            // pane the tab list does not cover) intact.
            documents: [
              ...ctx.documents.filter((doc) => doc.id !== bootstrap.documentId),
              newDoc,
            ],
            session: {
              ...ctx.session,
              editorLayout: setActivePaneTabs(
                ctx.session.editorLayout,
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
