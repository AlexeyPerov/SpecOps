import type {
  AppDomainState,
  ContextId,
  ContextSnapshot,
  DiskFingerprint,
  DocumentContentKind,
  DocumentState,
} from "../../domain/contracts";
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
  findFileTabForNormalizedPath,
  getActiveContextSnapshot,
  getActiveDocuments,
  getActiveSession,
  nextDocAndTabIds,
  nextTabId,
  patchActiveContext,
} from "./contextHelpers";
import { isPathUnderRoot } from "../../services/workspacePaths";
import {
  basename,
  buildDocument,
  buildEmptyUnsavedDocument,
  documentWithOpenedFilePayload,
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
  return patchActiveContext(state, (ctx) => {
    if (!ctx.session.openTabs.some((tab) => tab.id === tabId)) {
      return ctx;
    }
    return {
      ...ctx,
      session: { ...ctx.session, selectedTabId: tabId },
    };
  });
}

function reopenTabForDocument(state: AppDomainState, documentId: string): AppDomainState {
  const tabId = nextTabId();
  return patchActiveContext(state, (ctx) => ({
    ...ctx,
    session: {
      ...ctx.session,
      openTabs: [...ctx.session.openTabs, createFileTab(tabId, documentId)],
      selectedTabId: tabId,
    },
  }));
}

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
  document: DocumentState,
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

export function createDocumentTabsSlice(deps: {
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
          const { docId, tabId: tabIdNew } = nextDocAndTabIds();
          const newDocument = buildEmptyUnsavedDocument(docId);
          return {
            documents: [...ctx.documents, newDocument],
            session: {
              ...ctx.session,
              openTabs: [createFileTab(tabIdNew, docId)],
              selectedTabId: tabIdNew,
              lastActiveAgentId: null,
            },
          };
        }
        const closingTab = openTabs[idx];
        let selectedTabId =
          ctx.session.selectedTabId === tabId
            ? filtered[Math.max(0, idx - 1)]?.id ?? filtered[0]?.id ?? null
            : ctx.session.selectedTabId;
        if (ctx.session.selectedTabId === tabId && isAgentTab(closingTab)) {
          const nextAgentTab = findNextOpenAgentTabAfterClose(openTabs, tabId);
          if (nextAgentTab) {
            selectedTabId = nextAgentTab.id;
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
      update((state) =>
        patchActiveContext(state, (ctx) => {
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
        }),
      );
    },
    selectTab(tabId: string) {
      update((state) => selectTabInternal(state, tabId));
    },
    openOrFocusAgentTab(agentId: string) {
      update((state) => {
        const existingTab = getActiveSession(state).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .find((tab) => isAgentTab(tab) && tab.agentId === agentId);
        if (existingTab) {
          return selectTabInternal(state, existingTab.id);
        }
        const tabId = nextTabId();
        return patchActiveContext(state, (ctx) => ({
          ...ctx,
          session: {
            ...ctx.session,
            openTabs: [...ctx.session.openTabs, createAgentTab(tabId, agentId)],
            selectedTabId: tabId,
          },
        }));
      });
    },
    closeTabsForAgent(agentId: string) {
      update((state) => {
        const tabIds = getActiveSession(state).openTabs
          .map((rawTab) => normalizeTabState(rawTab))
          .filter((tab) => isAgentTab(tab) && tab.agentId === agentId)
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
          if (ctx.session.selectedTabId === tabId && isAgentTab(closingTab)) {
            const nextAgentTab = findNextOpenAgentTabAfterClose(openTabs, tabId);
            if (nextAgentTab) {
              selectedTabId = nextAgentTab.id;
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
    upgradeDocumentFromOpenedFile(
      documentId: string,
      filePath: string,
      content: string,
      contentKind: DocumentContentKind,
    ): void {
      update((state) =>
        patchActiveContext(state, (ctx) => ({
          ...ctx,
          documents: ctx.documents.map((documentState) =>
            documentState.id === documentId
              ? documentWithOpenedFilePayload(documentState, filePath, content, contentKind)
              : documentState,
          ),
        })),
      );
    },
    openFileInTab(filePath: string, content: string, contentKind: DocumentContentKind = "text"): string {
      let openedDocumentId = "";
      let recentFiles: string[] = [];
      update((state) => {
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        const duplicate = findDocumentByPath(state, filePath);
        if (duplicate) {
          openedDocumentId = duplicate.id;
          const upgradedState = patchActiveContext(state, (ctx) => ({
            ...ctx,
            documents: ctx.documents.map((documentState) =>
              documentState.id === duplicate.id
                ? documentWithOpenedFilePayload(
                    documentState,
                    filePath,
                    content,
                    contentKind,
                  )
                : documentState,
            ),
          }));
          const existingTab = getActiveSession(upgradedState).openTabs
            .map((rawTab) => normalizeTabState(rawTab))
            .find((tab) => isFileTab(tab) && tab.documentId === duplicate.id);
          if (existingTab) {
            return {
              ...selectTabInternal(upgradedState, existingTab.id),
              recentFiles,
            };
          }
          return {
            ...reopenTabForDocument(upgradedState, duplicate.id),
            recentFiles,
          };
        }

        const { docId, tabId } = nextDocAndTabIds();
        openedDocumentId = docId;
        const documentState = buildDocument(
          { id: docId, filePath },
          content,
          basename(filePath),
          contentKind,
        );

        return {
          ...patchActiveContext(state, (ctx) => ({
            documents: [...ctx.documents, documentState],
            session: {
              ...ctx.session,
              openTabs: [...ctx.session.openTabs, createFileTab(tabId, docId)],
              selectedTabId: tabId,
            },
          })),
          recentFiles,
        };
      });
      syncRecentFiles(recentFiles);
      return openedDocumentId;
    },
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
          const closingTab = openTabs[idx];
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
    setDocumentContent(documentId: string, content: string) {
      update((state) =>
        patchActiveContext(state, (ctx) => ({
          ...ctx,
          documents: ctx.documents.map((documentState) => {
            if (documentState.id !== documentId) {
              return documentState;
            }
            if (documentState.contentKind !== "text") {
              return documentState;
            }
            const lineEnding: "lf" | "crlf" = content.includes("\r\n") ? "crlf" : "lf";
            return {
              ...documentState,
              content,
              lineEnding,
              isDirty: content !== documentState.savedContent,
            };
          }),
        })),
      );
    },
    refreshUntitledTitle(documentId: string) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          let changed = false;
          const documents = ctx.documents.map((documentState) => {
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
            return ctx;
          }
          return { ...ctx, documents };
        }),
      );
    },
    normalizeUntitledTitles() {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          let changed = false;
          const documents = ctx.documents.map((documentState) => {
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
            return ctx;
          }
          return { ...ctx, documents };
        }),
      );
    },
    markDocumentSaved(documentId: string, filePath: string | null, content: string) {
      let recentFiles: string[] = [];
      update((state) => {
        const nextState = patchActiveContext(state, (ctx) => ({
          ...ctx,
          documents: ctx.documents.map((documentState) => {
            if (documentState.id !== documentId) {
              return documentState;
            }
            return {
              ...documentState,
              filePath,
              title: filePath ? basename(filePath) : documentState.title,
              savedContent: content,
              content,
              lineEnding: (content.includes("\r\n") ? "crlf" : "lf") as "lf" | "crlf",
              isDirty: false,
              language: inferLanguage(filePath),
              fileMissing: false,
            };
          }),
        }));
        recentFiles =
          filePath === null ? state.recentFiles : bumpRecentFile(state.recentFiles, filePath);
        return { ...nextState, recentFiles };
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
      update((state) =>
        patchActiveContext(state, (ctx) => ({
          ...ctx,
          documents: ctx.documents.map((documentState) => {
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
        })),
      );
    },
    applyDocumentKeepLocal(
      documentId: string,
      dismissedFingerprint: DiskFingerprint,
    ) {
      update((state) =>
        patchActiveContext(state, (ctx) => ({
          ...ctx,
          documents: ctx.documents.map((documentState) => {
            if (documentState.id !== documentId) {
              return documentState;
            }
            return {
              ...documentState,
              dismissedFingerprint,
            };
          }),
        })),
      );
    },
    setDocumentDiskState(
      documentId: string,
      patch: {
        diskFingerprint: DiskFingerprint | null;
        fileMissing: boolean;
      },
    ) {
      update((state) =>
        patchActiveContext(state, (ctx) => ({
          ...ctx,
          documents: ctx.documents.map((documentState) => {
            if (documentState.id !== documentId) {
              return documentState;
            }
            return {
              ...documentState,
              diskFingerprint: patch.diskFingerprint,
              fileMissing: patch.fileMissing,
            };
          }),
        })),
      );
    },
    renameDocument(documentId: string, filePath: string, title: string) {
      let recentFiles: string[] = [];
      update((state) => {
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        return {
          ...patchActiveContext(state, (ctx) => ({
            ...ctx,
            documents: ctx.documents.map((documentState) => {
              if (documentState.id !== documentId) {
                return documentState;
              }
              return {
                ...documentState,
                filePath,
                title,
                language: inferLanguage(filePath),
              };
            }),
          })),
          recentFiles,
        };
      });
      syncRecentFiles(recentFiles);
    },
    setDocumentScrollTop(documentId: string, scrollTop: number) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          let changed = false;
          const documents = ctx.documents.map((documentState) => {
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
            return ctx;
          }
          return { ...ctx, documents };
        }),
      );
    },
    setDocumentMarkdownViewMode(
      documentId: string,
      markdownViewMode: DocumentState["markdownViewMode"],
    ) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          let changed = false;
          const documents = ctx.documents.map((documentState) => {
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
            return ctx;
          }
          return { ...ctx, documents };
        }),
      );
    },
  };
}
