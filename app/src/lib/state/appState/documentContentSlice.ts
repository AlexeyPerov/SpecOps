import type {
  AppDomainState,
  ContextSnapshot,
  DiskFingerprint,
  DocumentContentKind,
  DocumentState,
} from "../../domain/contracts";
import {
  allTabs,
  appendTabToPane,
  createFileTab,
  findTabOwner,
  getSessionTabs,
  isFileTab,
  normalizeTabState,
  removeTabFromPane,
  revealFileTabsInLayout,
  setActivePaneInLayout,
  setActivePaneTabs,
} from "../../domain/contracts";
import { isEmptyUnsavedDocument } from "../../services/untitledDocument";
import { deriveUntitledTitle } from "../../services/untitledTitle";
import { bumpRecentFile } from "../../services/recentFiles";
import { syncRecentFiles } from "../../services/recentFilesSync";
import {
  findDocumentByPath,
  getActiveSession,
  nextDocAndTabIds,
  patchActiveContext,
} from "./contextHelpers";
import {
  basename,
  buildDocument,
  documentWithOpenedFilePayload,
  inferLanguage,
} from "./documentHelpers";
import { canCreateFileTabs, reopenTabForDocument, selectTabInternal } from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

/**
 * Select `tabId` within `paneId` and make that pane active. Used by the
 * file→pane path to focus an existing tab in the target pane. Returns the same
 * layout ref when the pane/tab is missing.
 */
function selectAndActivatePane(
  layout: AppDomainState["contexts"]["notepad"]["session"]["editorLayout"],
  paneId: string,
  tabId: string,
): AppDomainState["contexts"]["notepad"]["session"]["editorLayout"] {
  const activated = setActivePaneInLayout(layout, paneId);
  const pane = activated.panes.find((entry) => entry.id === paneId);
  if (!pane || !pane.tabs.some((tab) => tab.id === tabId)) {
    return activated;
  }
  if (pane.selectedTabId === tabId) {
    return activated;
  }
  return {
    ...activated,
    panes: activated.panes.map((entry) =>
      entry.id === paneId ? { ...entry, selectedTabId: tabId } : entry,
    ),
  };
}

export function createDocumentContentSlice(deps: { update: AppStateUpdate }) {
  const { update } = deps;

  return {
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
        if (!canCreateFileTabs(state)) {
          return state;
        }
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
          const existingTab = getSessionTabs(getActiveSession(upgradedState))
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
          ...patchActiveContext(state, (ctx) => {
            const tabs = getSessionTabs(ctx.session);
            return {
              documents: [...ctx.documents, documentState],
              session: {
                ...ctx.session,
                editorLayout: setActivePaneTabs(
                  ctx.session.editorLayout,
                  [...tabs, createFileTab(tabId, docId)],
                  tabId,
                ),
              },
            };
          }),
          recentFiles,
        };
      });
      syncRecentFiles(recentFiles);
      return openedDocumentId;
    },
    /**
     * Open a file into a specific pane (file→pane DnD, Phase 6). Mirrors
     * {@link openFileInTab} but targets `paneId` instead of the active pane,
     * and enforces the one-document-per-context invariant (Q9): if the file is
     * already open in another pane, that tab is removed first (steal); if it's
     * already in the target pane, it is simply focused. The target pane becomes
     * active and selects the opened/focused tab. No-ops (returns "") when the
     * active context can't host file tabs (chat-http).
     */
    openFileInPane(
      filePath: string,
      content: string,
      paneId: string,
      contentKind: DocumentContentKind = "text",
    ): string {
      let openedDocumentId = "";
      let recentFiles: string[] = [];
      update((state) => {
        if (!canCreateFileTabs(state)) {
          return state;
        }
        recentFiles = bumpRecentFile(state.recentFiles, filePath);
        const duplicate = findDocumentByPath(state, filePath);
        if (duplicate) {
          openedDocumentId = duplicate.id;
          // Locate any existing file tab for this document across ALL panes
          // (file tabs are 1:1 with documents within a context). The
          // steal/focus decision hangs off where that tab currently lives —
          // `allTabs` scans every pane, not just the active one.
          const existingTabId =
            allTabs(getActiveSession(state).editorLayout).find(
              (tab) => isFileTab(tab) && tab.documentId === duplicate.id,
            )?.id ?? null;
          const existingOwner =
            existingTabId === null
              ? null
              : findTabOwner(getActiveSession(state).editorLayout, existingTabId);

          // Steal (Q9): if the tab is in a different pane, remove it there.
          const stolenState =
            existingOwner && existingOwner.pane.id !== paneId
              ? patchActiveContext(state, (ctx) => ({
                  ...ctx,
                  session: {
                    ...ctx.session,
                    editorLayout: removeTabFromPane(
                      ctx.session.editorLayout,
                      existingOwner.pane.id,
                      existingOwner.tab.id,
                    ),
                  },
                }))
              : state;

          // Upgrade the document with the freshly-read file payload.
          const upgradedState = patchActiveContext(stolenState, (ctx) => ({
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

          // Focus the existing tab if it stayed in the target pane; otherwise
          // (it was stolen, or never had a tab) re-open it there.
          if (existingOwner && existingOwner.pane.id === paneId && existingTabId) {
            return {
              ...patchActiveContext(upgradedState, (ctx) => ({
                ...ctx,
                session: {
                  ...ctx.session,
                  editorLayout: revealFileTabsInLayout(
                    selectAndActivatePane(
                      ctx.session.editorLayout,
                      paneId,
                      existingTabId,
                    ),
                    duplicate.id,
                  ),
                },
              })),
              recentFiles,
            };
          }
          const reopenedTabId = nextDocAndTabIds().tabId;
          return {
            ...patchActiveContext(upgradedState, (ctx) => ({
              ...ctx,
              session: {
                ...ctx.session,
                editorLayout: revealFileTabsInLayout(
                  appendTabToPane(
                    setActivePaneInLayout(ctx.session.editorLayout, paneId),
                    createFileTab(reopenedTabId, duplicate.id),
                    paneId,
                  ),
                  duplicate.id,
                ),
              },
            })),
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
              editorLayout: appendTabToPane(
                setActivePaneInLayout(ctx.session.editorLayout, paneId),
                createFileTab(tabId, docId),
                paneId,
              ),
            },
          })),
          recentFiles,
        };
      });
      syncRecentFiles(recentFiles);
      return openedDocumentId;
    },
    setDocumentContent(documentId: string, content: string) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const previous = ctx.documents.find((documentState) => documentState.id === documentId);
          const wasEmpty =
            previous?.filePath === null &&
            previous.content === "" &&
            previous.savedContent === "";
          const hasContent = content.length > 0;

          let nextCtx = {
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
          };

          if (wasEmpty && hasContent) {
            const nextLayout = revealFileTabsInLayout(nextCtx.session.editorLayout, documentId);
            if (nextLayout !== nextCtx.session.editorLayout) {
              nextCtx = {
                ...nextCtx,
                session: { ...nextCtx.session, editorLayout: nextLayout },
              };
            }
          }
          return nextCtx;
        }),
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
        const nextState = patchActiveContext(state, (ctx) => {
          let nextCtx: ContextSnapshot = {
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
          };
          if (filePath !== null) {
            const nextLayout = revealFileTabsInLayout(nextCtx.session.editorLayout, documentId);
            if (nextLayout !== nextCtx.session.editorLayout) {
              nextCtx = {
                ...nextCtx,
                session: { ...nextCtx.session, editorLayout: nextLayout },
              };
            }
          }
          return nextCtx;
        });
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
