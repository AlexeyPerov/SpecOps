import type { AppDomainState, ContextId, ContextSnapshot } from "../../domain/contracts";
import {
  createFileTab,
  isFileTab,
  tabDocumentId,
} from "../../domain/contracts";
import { isEmptyUnsavedDocument } from "../../services/untitledDocument";
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
import { buildDocument, buildEmptyUnsavedDocument } from "./documentHelpers";
import { canCreateFileTabs, reopenTabForDocument, selectTabInternal } from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

function removeFileTabFromSnapshot(
  snapshot: ContextSnapshot,
  tabId: string,
  documentId: string,
  lastActiveWindowId: string,
): ContextSnapshot {
  const openTabs = snapshot.session.openTabs;
  const idx = openTabs.findIndex((tab) => tab.id === tabId);
  if (idx < 0) {
    return snapshot;
  }
  const filtered = openTabs.filter((tab) => tab.id !== tabId);
  const documents = snapshot.documents.filter((doc) => {
    if (doc.id !== documentId) {
      return true;
    }
    return filtered.some((tab) => isFileTab(tab) && tab.documentId === documentId);
  });
  if (filtered.length === 0) {
    const { docId, tabId: bootstrapTabId } = nextDocAndTabIds();
    const newDocument = buildEmptyUnsavedDocument(docId);
    return {
      documents: [...documents, newDocument],
      session: {
        ...snapshot.session,
        openTabs: [createFileTab(bootstrapTabId, docId)],
        selectedTabId: bootstrapTabId,
        lastActiveAgentId: null,
        lastActiveWindowId,
      },
    };
  }
  const selectedTabId =
    snapshot.session.selectedTabId === tabId
      ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
      : snapshot.session.selectedTabId;
  return {
    documents,
    session: {
      ...snapshot.session,
      openTabs: filtered,
      selectedTabId,
    },
  };
}

function addFileTabWithDocument(
  snapshot: ContextSnapshot,
  document: ContextSnapshot["documents"][number],
  tabId: string,
): ContextSnapshot {
  const existingTab = snapshot.session.openTabs.find(
    (tab) => isFileTab(tab) && tab.documentId === document.id,
  );
  if (existingTab) {
    return {
      ...snapshot,
      session: { ...snapshot.session, selectedTabId: existingTab.id },
    };
  }
  const hasDocument = snapshot.documents.some((doc) => doc.id === document.id);
  return {
    documents: hasDocument ? snapshot.documents : [...snapshot.documents, document],
    session: {
      ...snapshot.session,
      openTabs: [...snapshot.session.openTabs, createFileTab(tabId, document.id)],
      selectedTabId: tabId,
    },
  };
}

function isDefaultBootstrapWindow(state: AppDomainState): boolean {
  const ctx = getActiveContextSnapshot(state);
  if (ctx.session.openTabs.length !== 1) {
    return false;
  }
  const tab = ctx.session.openTabs[0];
  if (!isFileTab(tab)) {
    return false;
  }
  const documentState = ctx.documents.find((doc) => doc.id === tab.documentId);
  if (!documentState) {
    return false;
  }
  return isEmptyUnsavedDocument(documentState);
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
          const existingTab = workspace.snapshot.session.openTabs.find(
            (tab) => isFileTab(tab) && tab.documentId === existingInWorkspace.id,
          );
          return {
            ...state,
            contexts: {
              ...state.contexts,
              activeContextId: workspaceContextId,
              workspaces: state.contexts.workspaces.map((entry) =>
                entry.id === workspaceContextId
                  ? {
                      ...entry,
                      snapshot: existingTab
                        ? {
                            ...entry.snapshot,
                            session: {
                              ...entry.snapshot.session,
                              selectedTabId: existingTab.id,
                            },
                          }
                        : addFileTabWithDocument(
                            entry.snapshot,
                            existingInWorkspace,
                            nextTabId(),
                          ),
                    }
                  : entry,
              ),
            },
            editor: {
              ...state.editor,
              findReplaceOpen: false,
              goToOpen: false,
              previewMode: "editor",
            },
          };
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
            findReplaceOpen: false,
            goToOpen: false,
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
      const tab = getActiveSession(snapshot).openTabs.find((entry) => entry.id === tabId);
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
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const openTabs = ctx.session.openTabs;
          const idx = openTabs.findIndex((tab) => tab.id === tabId);
          if (idx < 0) {
            return ctx;
          }
          const filtered = openTabs.filter((tab) => tab.id !== tabId);
          if (filtered.length === 0) {
            return {
              ...ctx,
              session: {
                ...ctx.session,
                openTabs: [],
                selectedTabId: null,
                lastActiveAgentId: null,
              },
            };
          }
          const selectedTabId =
            ctx.session.selectedTabId === tabId
              ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
              : ctx.session.selectedTabId;
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
    transferActiveTabOut(): { filePath: string | null; content: string; title: string } | null {
      const snapshot = getSnapshot();
      const selectedTabId = getActiveSession(snapshot).selectedTabId;
      if (!selectedTabId) {
        return null;
      }
      const tab = getActiveSession(snapshot).openTabs.find((entry) => entry.id === selectedTabId);
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
            const existingTab = getActiveSession(state).openTabs.find(
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
        );
        if (isDefaultBootstrapWindow(state)) {
          return patchActiveContext(state, () => ({
            documents: [newDoc],
            session: {
              ...getActiveSession(state),
              openTabs: [createFileTab(tabId, docId)],
              selectedTabId: tabId,
            },
          }));
        }
        return patchActiveContext(state, (ctx) => ({
          documents: [...ctx.documents, newDoc],
          session: {
            ...ctx.session,
            openTabs: [...ctx.session.openTabs, createFileTab(tabId, docId)],
            selectedTabId: tabId,
          },
        }));
      });
      return documentId;
    },
  };
}
