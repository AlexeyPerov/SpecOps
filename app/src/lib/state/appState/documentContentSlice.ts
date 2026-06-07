import type {
  AppDomainState,
  DiskFingerprint,
  DocumentContentKind,
  DocumentState,
} from "../../domain/contracts";
import {
  createFileTab,
  isFileTab,
  normalizeTabState,
} from "../../domain/contracts";
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
