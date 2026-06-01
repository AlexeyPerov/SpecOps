import type { AppDomainState, DiskFingerprint, DocumentState } from "../../domain/contracts";
import {
  createAgentTab,
  createFileTab,
  isAgentTab,
  isFileTab,
  normalizeTabState,
  tabDocumentId,
} from "../../domain/contracts";
import { deriveUntitledTitle } from "../../services/untitledTitle";
import { isEmptyUnsavedDocument } from "../../services/untitledDocument";
import { findNextOpenAgentTabAfterClose } from "../../services/workspaceAgentSession";
import { bumpRecentFile } from "../../services/recentFiles";
import { syncRecentFiles } from "../../services/recentFilesSync";
import {
  findDocumentByPath,
  findDocumentByPathInContext,
  nextDocAndTabIds,
  nextTabId,
} from "./contextHelpers";
import {
  basename,
  buildDocument,
  buildEmptyUnsavedDocument,
  inferLanguage,
} from "./documentHelpers";
import {
  closeTabsForce,
  missingTabIdsToClose,
  moveTab,
  tabIdsToCloseOtherThan,
  tabIdsToCloseToRightOf,
} from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

function selectTabInternal(state: AppDomainState, tabId: string): AppDomainState {
  if (!state.session.openTabs.some((tab) => tab.id === tabId)) {
    return state;
  }
  return {
    ...state,
    session: { ...state.session, selectedTabId: tabId },
  };
}

function reopenTabForDocument(state: AppDomainState, documentId: string): AppDomainState {
  const tabId = nextTabId();
  return {
    ...state,
    session: {
      ...state.session,
      openTabs: [...state.session.openTabs, createFileTab(tabId, documentId)],
      selectedTabId: tabId,
    },
  };
}

function isDefaultBootstrapWindow(state: AppDomainState): boolean {
  if (state.session.openTabs.length !== 1) {
    return false;
  }
  const tab = state.session.openTabs[0];
  if (!isFileTab(tab)) {
    return false;
  }
  const documentState = state.documents.find((doc) => doc.id === tab.documentId);
  if (!documentState) {
    return false;
  }
  return isEmptyUnsavedDocument(documentState);
}

export function createDocumentTabsSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
}) {
  const { update, getSnapshot } = deps;

  function closeTabForce(tabId: string): void {
    update((state) => {
      const openTabs = state.session.openTabs;
      if (openTabs.length === 0) {
        return state;
      }
      const idx = openTabs.findIndex((tab) => tab.id === tabId);
      if (idx < 0) {
        return state;
      }
      const filtered = openTabs.filter((tab) => tab.id !== tabId);
      if (filtered.length === 0) {
        const { docId, tabId: tabIdNew } = nextDocAndTabIds();
        const newDocument = buildEmptyUnsavedDocument(docId);
        return {
          ...state,
          documents: [...state.documents, newDocument],
          session: {
            ...state.session,
            openTabs: [createFileTab(tabIdNew, docId)],
            selectedTabId: tabIdNew,
            lastActiveAgentId: null,
          },
        };
      }
      const closingTab = openTabs[idx];
      let selectedTabId =
        state.session.selectedTabId === tabId
          ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
          : state.session.selectedTabId;
      if (state.session.selectedTabId === tabId && isAgentTab(closingTab)) {
        const nextAgentTab = findNextOpenAgentTabAfterClose(openTabs, tabId);
        if (nextAgentTab) {
          selectedTabId = nextAgentTab.id;
        }
      }
      return {
        ...state,
        session: {
          ...state.session,
          openTabs: filtered,
          selectedTabId,
        },
      };
    });
  }

  return {
    createTab() {
      update((state) => {
        const { docId: id, tabId } = nextDocAndTabIds();
        const newDocument = buildEmptyUnsavedDocument(id);
        return {
          ...state,
          documents: [...state.documents, newDocument],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createFileTab(tabId, id)],
            selectedTabId: tabId,
          },
        };
      });
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    openOrFocusAgentTab(agentId: string) {
      update((state) => {
        const existingTab = state.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isAgentTab(tab) && tab.agentId === agentId);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        const tabId = nextTabId();
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createAgentTab(tabId, agentId)],
            selectedTabId: tabId,
          },
        };
      });
    },
    closeTabsForAgent(agentId: string) {
      update((state) => {
        const tabIds = state.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .filter((tab) => isAgentTab(tab) && tab.agentId === agentId)
          .map((tab) => tab.id);
        return closeTabsForce(state, tabIds, null);
      });
    },
    selectOrReopenTabForDocument(documentId: string) {
      update((state) => {
        const existingTab = state.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isFileTab(tab) && tab.documentId === documentId);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
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
      update((state) => {
        const openTabs = moveTab(state.session.openTabs, fromIndex, toIndex);
        if (openTabs === state.session.openTabs) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            openTabs,
          },
        };
      });
    },
    closeTab(tabId: string) {
      update((state) => {
        const openTabs = state.session.openTabs;
        if (openTabs.length <= 1) {
          return state;
        }
        const idx = openTabs.findIndex((tab) => tab.id === tabId);
        if (idx < 0) {
          return state;
        }
        const filtered = openTabs.filter((tab) => tab.id !== tabId);
        const closingTab = openTabs[idx];
        let selectedTabId =
          state.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : state.session.selectedTabId;
        if (state.session.selectedTabId === tabId && isAgentTab(closingTab)) {
          const nextAgentTab = findNextOpenAgentTabAfterClose(openTabs, tabId);
          if (nextAgentTab) {
            selectedTabId = nextAgentTab.id;
          }
        }
        return {
          ...state,
          session: {
            ...state.session,
            openTabs: filtered,
            selectedTabId,
          },
        };
      });
    },
    closeTabForce,
    closeTabWithPrompt(tabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const targetTab = snapshot.session.openTabs.find((tab) => tab.id === tabId);
      if (!targetTab) {
        return false;
      }
      const targetDocumentId = tabDocumentId(targetTab);
      const targetDocument = targetDocumentId
        ? snapshot.documents.find((documentState) => documentState.id === targetDocumentId)
        : undefined;
      if (targetDocument?.isDirty && !confirm(`Close ${targetDocument.title} without saving?`)) {
        return false;
      }
      closeTabForce(tabId);
      return true;
    },
    closeOtherTabs(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      if (!snapshot.session.openTabs.some((tab) => tab.id === contextTabId)) {
        return false;
      }
      const tabIds = tabIdsToCloseOtherThan(snapshot.session.openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = snapshot.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
          continue;
        }
        const doc = snapshot.documents.find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeTabsToRight(contextTabId: string, confirm: (message: string) => boolean): boolean {
      const snapshot = getSnapshot();
      const tabIds = tabIdsToCloseToRightOf(snapshot.session.openTabs, contextTabId);
      if (tabIds.length === 0) {
        return false;
      }

      for (const tabId of tabIds) {
        const tab = snapshot.session.openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
          continue;
        }
        const doc = snapshot.documents.find((documentState) => documentState.id === tab.documentId);
        if (doc?.isDirty && !confirm(`Close ${doc.title} without saving?`)) {
          return false;
        }
      }

      update((state) => closeTabsForce(state, tabIds, contextTabId));
      return true;
    },
    closeMissingFileTabs(): boolean {
      const snapshot = getSnapshot();
      const tabIds = missingTabIdsToClose(snapshot.session.openTabs, snapshot.documents);
      if (tabIds.length === 0) {
        return false;
      }

      update((state) => closeTabsForce(state, tabIds, null));
      return true;
    },
    openFileInTab(filePath: string, content: string): string {
      let openedDocumentId = "";
      let recentFiles: string[] = [];
      update((state) => {
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        const duplicate = findDocumentByPath(state, filePath);
        if (duplicate) {
          openedDocumentId = duplicate.id;
          const existingTab = state.session.openTabs
            .map((rawTab) => normalizeTabState(rawTab))
            .find((tab) => isFileTab(tab) && tab.documentId === duplicate.id);
          if (existingTab) {
            return {
              ...selectTabInternal(state, existingTab.id),
              recentFiles,
            };
          }
          return {
            ...reopenTabForDocument(state, duplicate.id),
            recentFiles,
          };
        }

        const { docId, tabId } = nextDocAndTabIds();
        openedDocumentId = docId;
        const documentState = buildDocument(
          { id: docId, filePath },
          content,
          basename(filePath),
        );

        return {
          ...state,
          documents: [...state.documents, documentState],
          recentFiles,
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createFileTab(tabId, docId)],
            selectedTabId: tabId,
          },
        };
      });
      syncRecentFiles(recentFiles);
      return openedDocumentId;
    },
    buildTabTransferPayload(
      tabId: string,
    ): { filePath: string | null; content: string; title: string } | null {
      const snapshot = getSnapshot();
      const tab = snapshot.session.openTabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return null;
      }
      const documentId = tabDocumentId(tab);
      const doc = documentId
        ? snapshot.documents.find((documentState) => documentState.id === documentId)
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
      const selectedTabId = snapshot.session.selectedTabId;
      if (!selectedTabId) {
        return null;
      }
      const tab = snapshot.session.openTabs.find((entry) => entry.id === selectedTabId);
      if (!tab) {
        return null;
      }
      const documentId = tabDocumentId(tab);
      const doc = documentId
        ? snapshot.documents.find((documentState) => documentState.id === documentId)
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
        if (payload.filePath) {
          const duplicate = findDocumentByPath(state, payload.filePath);
          if (duplicate) {
            documentId = duplicate.id;
            const existingTab = state.session.openTabs.find(
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
          return {
            ...state,
            documents: [newDoc],
            session: {
              ...state.session,
              openTabs: [createFileTab(tabId, docId)],
              selectedTabId: tabId,
            },
          };
        }
        return {
          ...state,
          documents: [...state.documents, newDoc],
          session: {
            ...state.session,
            openTabs: [...state.session.openTabs, createFileTab(tabId, docId)],
            selectedTabId: tabId,
          },
        };
      });
      return documentId;
    },
    setDocumentContent(documentId: string, content: string) {
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          const lineEnding: "lf" | "crlf" = content.includes("\r\n")
            ? "crlf"
            : "lf";
          return {
            ...documentState,
            content,
            lineEnding,
            isDirty: content !== documentState.savedContent,
          };
        });
        return { ...state, documents };
      });
    },
    refreshUntitledTitle(documentId: string) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId || documentState.filePath !== null) {
            return documentState;
          }
          const title = deriveUntitledTitle(documentState.content);
          if (title === documentState.title) {
            return documentState;
          }
          changed = true;
          return { ...documentState, title };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    normalizeUntitledTitles() {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.filePath !== null) {
            return documentState;
          }
          const title = deriveUntitledTitle(documentState.content);
          if (title === documentState.title) {
            return documentState;
          }
          changed = true;
          return { ...documentState, title };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    markDocumentSaved(documentId: string, filePath: string | null, content: string) {
      let recentFiles: string[] = [];
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            filePath,
            title: filePath ? basename(filePath) : documentState.title,
            savedContent: content,
            content,
            lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as
              | "lf"
              | "crlf",
            isDirty: false,
            language: inferLanguage(filePath),
            fileMissing: false,
          };
        });
        recentFiles =
          filePath === null
            ? state.recentFiles
            : bumpRecentFile(state.recentFiles, filePath);
        return { ...state, documents, recentFiles };
      });
      if (filePath !== null) {
        syncRecentFiles(recentFiles);
      }
    },
    applyDocumentDiskReload(
      documentId: string,
      content: string,
      diskFingerprint: DiskFingerprint,
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            content,
            savedContent: content,
            isDirty: false,
            diskFingerprint,
            dismissedFingerprint: null,
            fileMissing: false,
            lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as "lf" | "crlf",
          };
        }),
      }));
    },
    applyDocumentKeepLocal(
      documentId: string,
      dismissedFingerprint: DiskFingerprint,
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            dismissedFingerprint,
          };
        }),
      }));
    },
    setDocumentDiskState(
      documentId: string,
      patch: {
        diskFingerprint: DiskFingerprint | null;
        fileMissing: boolean;
      },
    ) {
      update((state) => ({
        ...state,
        documents: state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            diskFingerprint: patch.diskFingerprint,
            fileMissing: patch.fileMissing,
          };
        }),
      }));
    },
    renameDocument(documentId: string, filePath: string, title: string) {
      let recentFiles: string[] = [];
      update((state) => {
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          return {
            ...documentState,
            filePath,
            title,
            language: inferLanguage(filePath),
          };
        });
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        return { ...state, documents, recentFiles };
      });
      syncRecentFiles(recentFiles);
    },
    setDocumentScrollTop(documentId: string, scrollTop: number) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          if (documentState.scrollTop === scrollTop) {
            return documentState;
          }
          changed = true;
          return { ...documentState, scrollTop };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
    setDocumentMarkdownViewMode(
      documentId: string,
      markdownViewMode: DocumentState["markdownViewMode"],
    ) {
      update((state) => {
        let changed = false;
        const documents = state.documents.map((documentState) => {
          if (documentState.id !== documentId) {
            return documentState;
          }
          if (documentState.markdownViewMode === markdownViewMode) {
            return documentState;
          }
          changed = true;
          return { ...documentState, markdownViewMode };
        });
        if (!changed) {
          return state;
        }
        return { ...state, documents };
      });
    },
  };
}
