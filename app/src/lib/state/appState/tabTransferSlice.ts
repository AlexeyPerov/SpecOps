import type { AppDomainState, ContextId, ContextSnapshot, TabGroupEntry } from "../../domain/contracts";
import {
  allTabs,
  createFileTab,
  findTabOwner,
  getSessionTabs,
  isFileTab,
  recomputeSelectedTabId,
  setActivePaneTabs,
  findTabGroup,
  tabDocumentId,
  withTabGroupSnapshot,
} from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
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
  patchContextById,
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
    moveFileTabToContext(normalizedPath: string, targetContextId: ContextId): string | null {
      let movedDocumentId: string | null = null;
      update((state) => {
        const contexts = [
          ...state.contexts.tabGroups.map((entry) => ({ id: entry.id as ContextId, snapshot: entry.snapshot })),
          ...state.contexts.workspaces.map((entry) => ({ id: entry.id, snapshot: entry.snapshot })),
        ];
        const target = contexts.find((entry) => entry.id === targetContextId);
        const source = contexts.find((entry) =>
          Boolean(findFileTabForNormalizedPath(entry.snapshot, normalizedPath)),
        );
        if (!target || !source) {
          return state;
        }
        const sourceMatch = findFileTabForNormalizedPath(source.snapshot, normalizedPath);
        if (!sourceMatch) {
          return state;
        }
        movedDocumentId = sourceMatch.documentId;
        if (source.id === target.id) {
          return selectTabInternal(
            {
              ...state,
              contexts: { ...state.contexts, activeContextId: targetContextId },
              editor: { ...state.editor, previewMode: "editor" },
            },
            sourceMatch.tabId,
          );
        }

        const targetMatch = findFileTabForNormalizedPath(target.snapshot, normalizedPath);
        const nextSource = removeFileTabFromSnapshot(
          source.snapshot,
          sourceMatch.tabId,
          sourceMatch.documentId,
          source.snapshot.session.lastActiveWindowId,
        );
        const nextTarget = targetMatch
          ? target.snapshot
          : addFileTabWithDocument(target.snapshot, sourceMatch.document, nextTabId());
        const patched = patchContextById(
          patchContextById(state, source.id, () => nextSource),
          target.id,
          () => nextTarget,
        );
        const nextState = {
          ...patched,
          contexts: { ...patched.contexts, activeContextId: targetContextId },
          editor: { ...state.editor, previewMode: "editor" as const },
        };
        return targetMatch ? selectTabInternal(nextState, targetMatch.tabId) : nextState;
      });
      return movedDocumentId;
    },
    /**
     * Move a file tab of the active context into a tab group without changing
     * the active context. Returns the new tab id, or null when the tab cannot
     * move (unknown tab or group, same context, or a dirty buffer whose file is
     * already open in the destination).
     */
    moveFileTabToTabGroup(tabId: string, groupId: ContextId): string | null {
      let movedTabId: string | null = null;
      update((state) => {
        const sourceId = state.contexts.activeContextId;
        const target = findTabGroup(state.contexts.tabGroups, groupId);
        const source = getActiveContextSnapshot(state);
        if (!target || sourceId === groupId) {
          return state;
        }
        const tab = allTabs(source.session.editorLayout).find((entry) => entry.id === tabId);
        if (!tab || !isFileTab(tab)) {
          return state;
        }
        const document = source.documents.find((doc) => doc.id === tab.documentId);
        if (!document) {
          return state;
        }
        const existing = document.filePath
          ? findFileTabForNormalizedPath(target.snapshot, normalizePathSync(document.filePath))
          : null;
        if (existing && document.isDirty) {
          return state;
        }
        const nextSource = removeFileTabFromSnapshot(
          source,
          tab.id,
          document.id,
          source.session.lastActiveWindowId,
        );
        let nextTarget = target.snapshot;
        if (existing) {
          movedTabId = existing.tabId;
        } else {
          movedTabId = nextTabId();
          nextTarget = addFileTabWithDocument(target.snapshot, document, movedTabId);
        }
        return patchContextById(
          patchContextById(state, sourceId, () => nextSource),
          groupId,
          () => nextTarget,
        );
      });
      return movedTabId;
    },
    migrateTabGroupFileTabToWorkspace(
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
        let tabGroup: TabGroupEntry | null = null;
        let tabGroupMatch: ReturnType<typeof findFileTabForNormalizedPath> = null;
        for (const group of state.contexts.tabGroups) {
          tabGroupMatch = findFileTabForNormalizedPath(group.snapshot, normalizedPath);
          if (tabGroupMatch) {
            tabGroup = group;
            break;
          }
        }
        if (!tabGroup || !tabGroupMatch) {
          return state;
        }
        const nextTabGroups = withTabGroupSnapshot(
          state.contexts.tabGroups,
          tabGroup.id,
          removeFileTabFromSnapshot(
            tabGroup.snapshot,
            tabGroupMatch.tabId,
            tabGroupMatch.documentId,
            tabGroup.snapshot.session.lastActiveWindowId,
          ),
        );
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
              tabGroups: nextTabGroups,
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

        migratedDocumentId = tabGroupMatch.documentId;
        const nextWorkspace = addFileTabWithDocument(
          workspace.snapshot,
          tabGroupMatch.document,
          nextTabId(),
        );
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: workspaceContextId,
            tabGroups: nextTabGroups,
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
