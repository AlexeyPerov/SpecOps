import type {
  AppDomainState,
  AppThemeState,
  ContextId,
  ContextSnapshot,
  DocumentState,
  WindowBounds,
  WindowSessionSnapshot,
  WorkspaceLayoutState,
} from "../../domain/contracts";
import { createFileTab } from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
import {
  defaultWorkspaceLayout,
  normalizeWorkspaceLayout,
} from "../../services/panelLayout";
import {
  cloneContextSnapshot,
  findWorkspaceByPath,
  getActiveContextSnapshot,
  nextDocAndTabIds,
  nextWorkspaceId,
  normalizeWorkspaceEntries,
  NOTEPAD_CONTEXT_ID,
  reindexIdCountersFromContexts,
} from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

function fallbackContextSnapshot(lastActiveWindowId: string): ContextSnapshot {
  const { docId: documentId, tabId } = nextDocAndTabIds();
  return {
    documents: [buildEmptyUnsavedDocument(documentId)],
    session: {
      selectedTabId: tabId,
      openTabs: [createFileTab(tabId, documentId)],
      lastActiveWindowId,
      windowBounds: null,
      lastActiveAgentId: null,
    },
  };
}

function ensureContextSnapshotHasTab(snapshot: ContextSnapshot): ContextSnapshot {
  if (snapshot.session.openTabs.length > 0) {
    return snapshot;
  }
  return fallbackContextSnapshot(snapshot.session.lastActiveWindowId);
}

export function createWorkspaceContextsSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
  set: (state: AppDomainState) => void;
  applyTheme: (theme: AppThemeState) => void;
  getInitialEditor: () => AppDomainState["editor"];
  syncLegacyFieldsIntoActiveContext: (state: AppDomainState) => AppDomainState;
  withActiveContextApplied: (state: AppDomainState) => AppDomainState;
}) {
  const {
    update,
    getSnapshot,
    set,
    applyTheme,
    getInitialEditor,
    syncLegacyFieldsIntoActiveContext,
    withActiveContextApplied,
  } = deps;

  function toCurrentWindowSnapshot(state: AppDomainState): WindowSessionSnapshot {
    const synced = syncLegacyFieldsIntoActiveContext(state);
    return {
      activeContextId: synced.contexts.activeContextId,
      notepad: cloneContextSnapshot(synced.contexts.notepad),
      workspaces: normalizeWorkspaceEntries(synced.contexts.workspaces),
      editorPreferences: {
        zoomPercent: synced.editor.zoomPercent,
        wrapLines: synced.editor.wrapLines,
      },
    };
  }

  const slice = {
    applyWindowSession(snapshot: WindowSessionSnapshot, recentFiles: string[] = []) {
      const normalizedNotepad = ensureContextSnapshotHasTab(cloneContextSnapshot(snapshot.notepad));
      const normalizedWorkspaces = normalizeWorkspaceEntries(snapshot.workspaces).map((workspace) => ({
        ...workspace,
        snapshot: ensureContextSnapshotHasTab(workspace.snapshot),
      }));
      const activeContextId =
        snapshot.activeContextId === NOTEPAD_CONTEXT_ID ||
        normalizedWorkspaces.some((workspace) => workspace.id === snapshot.activeContextId)
          ? snapshot.activeContextId
          : NOTEPAD_CONTEXT_ID;
      const contexts = {
        activeContextId,
        notepad: normalizedNotepad,
        workspaces: normalizedWorkspaces,
      };
      const activeContextSnapshot =
        activeContextId === NOTEPAD_CONTEXT_ID
          ? contexts.notepad
          : contexts.workspaces.find((workspace) => workspace.id === activeContextId)?.snapshot ??
            contexts.notepad;
      reindexIdCountersFromContexts(contexts);
      const preservedSettings = getSnapshot().settings;
      const preservedTheme = getSnapshot().theme;
      set({
        contexts,
        documents: activeContextSnapshot.documents,
        session: activeContextSnapshot.session,
        settings: preservedSettings,
        theme: preservedTheme,
        recentFiles,
        editor: {
          ...getInitialEditor(),
          ...snapshot.editorPreferences,
          findReplaceOpen: false,
          goToOpen: false,
          previewMode: "editor",
        },
      });
      applyTheme(preservedTheme);
    },
    getWindowSessionSnapshot(): WindowSessionSnapshot {
      return toCurrentWindowSnapshot(getSnapshot());
    },
    getActiveContext() {
      const state = getSnapshot();
      if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
        return {
          id: NOTEPAD_CONTEXT_ID,
          kind: "notepad" as const,
          snapshot: getActiveContextSnapshot(state),
        };
      }
      const workspace =
        state.contexts.workspaces.find((entry) => entry.id === state.contexts.activeContextId) ?? null;
      return {
        id: state.contexts.activeContextId,
        kind: "workspace" as const,
        rootPath: workspace?.rootPath ?? null,
        snapshot: getActiveContextSnapshot(state),
      };
    },
    getActiveDocuments() {
      return getSnapshot().documents;
    },
    getActiveSession() {
      return getSnapshot().session;
    },
    isNotepadActive() {
      return getSnapshot().contexts.activeContextId === NOTEPAD_CONTEXT_ID;
    },
    getWorkspaceRoot(contextId?: ContextId): string | null {
      const state = getSnapshot();
      const targetId = contextId ?? state.contexts.activeContextId;
      if (targetId === NOTEPAD_CONTEXT_ID) {
        return null;
      }
      return state.contexts.workspaces.find((workspace) => workspace.id === targetId)?.rootPath ?? null;
    },
    switchContext(contextId: ContextId): boolean {
      let switched = false;
      update((state) => {
        const synced = syncLegacyFieldsIntoActiveContext(state);
        const exists =
          contextId === NOTEPAD_CONTEXT_ID ||
          synced.contexts.workspaces.some((workspace) => workspace.id === contextId);
        if (!exists || synced.contexts.activeContextId === contextId) {
          return synced;
        }
        switched = true;
        return withActiveContextApplied({
          ...synced,
          contexts: {
            ...synced.contexts,
            activeContextId: contextId,
          },
          editor: {
            ...synced.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        });
      });
      return switched;
    },
    addWorkspace(rootPath: string): ContextId | null {
      let createdId: ContextId | null = null;
      update((state) => {
        const synced = syncLegacyFieldsIntoActiveContext(state);
        const normalizedRoot = normalizePathSync(rootPath);
        const duplicate = findWorkspaceByPath(synced.contexts.workspaces, normalizedRoot);
        if (duplicate) {
          return synced;
        }
        const workspaceId = nextWorkspaceId();
        createdId = workspaceId;
        const workspaceSnapshot = fallbackContextSnapshot(synced.session.lastActiveWindowId);
        return withActiveContextApplied({
          ...synced,
          contexts: {
            ...synced.contexts,
            activeContextId: workspaceId,
            workspaces: [
              ...synced.contexts.workspaces,
              {
                id: workspaceId,
                rootPath: normalizedRoot,
                snapshot: workspaceSnapshot,
              },
            ],
          },
          editor: {
            ...synced.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        });
      });
      return createdId;
    },
    closeWorkspace(
      workspaceId: ContextId,
      options?: {
        resolveAction?: (dirtyDocuments: DocumentState[]) => "save-all" | "discard-all" | "cancel";
        saveAllDirtyDocuments?: (dirtyDocuments: DocumentState[]) => void;
      },
    ): boolean {
      let closed = false;
      update((state) => {
        const synced = syncLegacyFieldsIntoActiveContext(state);
        const targetWorkspace = synced.contexts.workspaces.find((workspace) => workspace.id === workspaceId);
        if (!targetWorkspace) {
          return synced;
        }
        const dirtyDocuments = targetWorkspace.snapshot.documents.filter((documentState) => documentState.isDirty);
        let action: "save-all" | "discard-all" | "cancel" = "discard-all";
        if (dirtyDocuments.length > 0) {
          action = options?.resolveAction?.(dirtyDocuments) ?? "cancel";
        }
        if (action === "cancel") {
          return synced;
        }
        if (action === "save-all") {
          if (!options?.saveAllDirtyDocuments) {
            return synced;
          }
          options.saveAllDirtyDocuments(dirtyDocuments);
        }
        closed = true;
        return withActiveContextApplied({
          ...synced,
          contexts: {
            ...synced.contexts,
            activeContextId: NOTEPAD_CONTEXT_ID,
            workspaces: synced.contexts.workspaces.filter((workspace) => workspace.id !== workspaceId),
          },
          editor: {
            ...synced.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        });
      });
      return closed;
    },
    setLastActiveAgentId(agentId: string | null) {
      update((state) => {
        if (state.session.lastActiveAgentId === agentId) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            lastActiveAgentId: agentId,
          },
        };
      });
    },
    getLastActiveAgentId(): string | null {
      return getSnapshot().session.lastActiveAgentId ?? null;
    },
    setWindowBounds(windowBounds: WindowBounds | null) {
      update((state) => {
        if (state.session.windowBounds === windowBounds) {
          return state;
        }
        return {
          ...state,
          session: {
            ...state.session,
            windowBounds,
          },
        };
      });
    },
    getActiveWorkspaceLayout(): WorkspaceLayoutState {
      const state = getSnapshot();
      if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
        return defaultWorkspaceLayout();
      }
      return normalizeWorkspaceLayout(state.session.layout);
    },
    updateActiveWorkspaceLayout(partial: Partial<WorkspaceLayoutState>): void {
      update((state) => {
        if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
          return state;
        }
        const current = normalizeWorkspaceLayout(state.session.layout);
        const nextLayout = normalizeWorkspaceLayout({ ...current, ...partial });
        return {
          ...state,
          session: {
            ...state.session,
            layout: nextLayout,
          },
        };
      });
    },
    setProjectPanelCollapsed(projectPanelCollapsed: boolean) {
      slice.updateActiveWorkspaceLayout({ projectPanelCollapsed });
    },
    setAgentsSidebarCollapsed(agentsSidebarCollapsed: boolean) {
      slice.updateActiveWorkspaceLayout({ agentsSidebarCollapsed });
    },
  };

  return slice;
}
