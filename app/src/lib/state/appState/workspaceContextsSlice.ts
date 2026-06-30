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
import {
  createFileTab,
  createSinglePaneLayout,
  getSessionTabs,
} from "../../domain/contracts";
import { normalizePathSync } from "../../services/diskFingerprint";
import { isChatHttpRailVisible } from "../../ai/providers/chatHttpRailGating";
import {
  DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
  defaultWorkspaceLayout,
  normalizeActivityRailWidthPx,
  normalizeWorkspaceLayout,
} from "../../services/panelLayout";
import {
  CHAT_HTTP_CONTEXT_KEY,
  cloneContextSnapshot,
  findWorkspaceByPath,
  getActiveContextSnapshot,
  getActiveDocuments,
  getActiveSession,
  nextDocAndTabIds,
  nextWorkspaceId,
  normalizeWorkspaceEntries,
  isChatHttpContext,
  NOTEPAD_CONTEXT_ID,
  patchActiveContext,
  reindexIdCountersFromContexts,
} from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";
import { moveArrayItem } from "./tabHelpers";

type AppStateUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

function fallbackContextSnapshot(lastActiveWindowId: string): ContextSnapshot {
  const { docId: documentId, tabId } = nextDocAndTabIds();
  return {
    documents: [buildEmptyUnsavedDocument(documentId)],
    session: {
      editorLayout: createSinglePaneLayout([createFileTab(tabId, documentId, false, true)], tabId),
      lastActiveWindowId,
      windowBounds: null,
      lastActiveSessionId: null,
    },
  };
}

function ensureContextSnapshotHasTab(snapshot: ContextSnapshot): ContextSnapshot {
  if (getSessionTabs(snapshot.session).length > 0) {
    return snapshot;
  }
  return fallbackContextSnapshot(snapshot.session.lastActiveWindowId);
}

function canRestoreChatHttpAsActive(settings: AppDomainState["settings"]): boolean {
  return isChatHttpRailVisible(
    settings.providerSettings,
    settings.providerApiKeys,
    settings.providerSettings.debugChat,
    settings.chatHttp,
  );
}

export function createWorkspaceContextsSlice(deps: {
  update: AppStateUpdate;
  getSnapshot: () => AppDomainState;
  set: (state: AppDomainState) => void;
  applyTheme: (theme: AppThemeState) => void;
  getInitialEditor: () => AppDomainState["editor"];
}) {
  const { update, getSnapshot, set, applyTheme, getInitialEditor } = deps;

  function toCurrentWindowSnapshot(state: AppDomainState): WindowSessionSnapshot {
    return {
      activeContextId: state.contexts.activeContextId,
      notepad: cloneContextSnapshot(state.contexts.notepad),
      chatHttp: cloneContextSnapshot(state.contexts.chatHttp),
      workspaces: normalizeWorkspaceEntries(state.contexts.workspaces),
      editorPreferences: {
        zoomPercent: state.editor.zoomPercent,
        wrapLines: state.editor.wrapLines,
      },
      activityRailWidthPx: state.activityRailWidthPx,
    };
  }

  const slice = {
    applyWindowSession(snapshot: WindowSessionSnapshot, recentFiles: string[] = []) {
      const preservedSettings = getSnapshot().settings;
      const normalizedNotepad = ensureContextSnapshotHasTab(cloneContextSnapshot(snapshot.notepad));
      const normalizedChatHttp = ensureContextSnapshotHasTab(
        cloneContextSnapshot(snapshot.chatHttp ?? snapshot.notepad),
      );
      const normalizedWorkspaces = normalizeWorkspaceEntries(snapshot.workspaces).map((workspace) => ({
        ...workspace,
        snapshot: ensureContextSnapshotHasTab(workspace.snapshot),
      }));
      const activeContextId =
        snapshot.activeContextId === NOTEPAD_CONTEXT_ID ||
        (isChatHttpContext(snapshot.activeContextId) &&
          canRestoreChatHttpAsActive(preservedSettings)) ||
        normalizedWorkspaces.some((workspace) => workspace.id === snapshot.activeContextId)
          ? snapshot.activeContextId
          : NOTEPAD_CONTEXT_ID;
      const contexts = {
        activeContextId,
        notepad: normalizedNotepad,
        chatHttp: normalizedChatHttp,
        workspaces: normalizedWorkspaces,
      };
      reindexIdCountersFromContexts(contexts);
      const preservedTheme = getSnapshot().theme;
      const railWidth =
        snapshot.activityRailWidthPx !== undefined
          ? normalizeActivityRailWidthPx(snapshot.activityRailWidthPx)
          : DEFAULT_ACTIVITY_RAIL_WIDTH_PX;
      set({
        contexts,
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
        activityRailWidthPx: railWidth,
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
      if (isChatHttpContext(state.contexts.activeContextId)) {
        return {
          id: CHAT_HTTP_CONTEXT_KEY,
          kind: "chat-http" as const,
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
      return getActiveDocuments(getSnapshot());
    },
    getActiveSession() {
      return getActiveSession(getSnapshot());
    },
    isNotepadActive() {
      return getSnapshot().contexts.activeContextId === NOTEPAD_CONTEXT_ID;
    },
    getWorkspaceRoot(contextId?: ContextId): string | null {
      const state = getSnapshot();
      const targetId = contextId ?? state.contexts.activeContextId;
      if (targetId === NOTEPAD_CONTEXT_ID || isChatHttpContext(targetId)) {
        return null;
      }
      return state.contexts.workspaces.find((workspace) => workspace.id === targetId)?.rootPath ?? null;
    },
    switchContext(contextId: ContextId): boolean {
      let switched = false;
      update((state) => {
        const canOpenChatHttpContext =
          !isChatHttpContext(contextId) || canRestoreChatHttpAsActive(state.settings);
        const exists =
          contextId === NOTEPAD_CONTEXT_ID ||
          (isChatHttpContext(contextId) && canOpenChatHttpContext) ||
          state.contexts.workspaces.some((workspace) => workspace.id === contextId);
        if (!exists || state.contexts.activeContextId === contextId) {
          return state;
        }
        switched = true;
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: contextId,
          },
          editor: {
            ...state.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        };
      });
      return switched;
    },
    addWorkspace(rootPath: string): ContextId | null {
      let createdId: ContextId | null = null;
      update((state) => {
        const normalizedRoot = normalizePathSync(rootPath);
        const duplicate = findWorkspaceByPath(state.contexts.workspaces, normalizedRoot);
        if (duplicate) {
          return state;
        }
        const workspaceId = nextWorkspaceId();
        createdId = workspaceId;
        const workspaceSnapshot = fallbackContextSnapshot(getActiveSession(state).lastActiveWindowId);
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: workspaceId,
            workspaces: [
              ...state.contexts.workspaces,
              {
                id: workspaceId,
                rootPath: normalizedRoot,
                snapshot: workspaceSnapshot,
              },
            ],
          },
          editor: {
            ...state.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        };
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
        const targetWorkspace = state.contexts.workspaces.find((workspace) => workspace.id === workspaceId);
        if (!targetWorkspace) {
          return state;
        }
        const dirtyDocuments = targetWorkspace.snapshot.documents.filter((documentState) => documentState.isDirty);
        let action: "save-all" | "discard-all" | "cancel" = "discard-all";
        if (dirtyDocuments.length > 0) {
          action = options?.resolveAction?.(dirtyDocuments) ?? "cancel";
        }
        if (action === "cancel") {
          return state;
        }
        if (action === "save-all") {
          if (!options?.saveAllDirtyDocuments) {
            return state;
          }
          options.saveAllDirtyDocuments(dirtyDocuments);
        }
        closed = true;
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: NOTEPAD_CONTEXT_ID,
            workspaces: state.contexts.workspaces.filter((workspace) => workspace.id !== workspaceId),
          },
          editor: {
            ...state.editor,
            findReplaceOpen: false,
            goToOpen: false,
            previewMode: "editor",
          },
        };
      });
      return closed;
    },
    setLastActiveSessionId(sessionId: string | null) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          if (ctx.session.lastActiveSessionId === sessionId) {
            return ctx;
          }
          return {
            ...ctx,
            session: {
              ...ctx.session,
              lastActiveSessionId: sessionId,
            },
          };
        }),
      );
    },
    getLastActiveSessionId(): string | null {
      return getActiveSession(getSnapshot()).lastActiveSessionId ?? null;
    },
    setWindowBounds(windowBounds: WindowBounds | null) {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          if (ctx.session.windowBounds === windowBounds) {
            return ctx;
          }
          return {
            ...ctx,
            session: {
              ...ctx.session,
              windowBounds,
            },
          };
        }),
      );
    },
    getActiveWorkspaceLayout(): WorkspaceLayoutState {
      const state = getSnapshot();
      if (state.contexts.activeContextId === NOTEPAD_CONTEXT_ID) {
        return defaultWorkspaceLayout();
      }
      return normalizeWorkspaceLayout(getActiveSession(state).layout);
    },
    updateActiveWorkspaceLayout(partial: Partial<WorkspaceLayoutState>): void {
      update((state) =>
        patchActiveContext(state, (ctx) => {
          const current = normalizeWorkspaceLayout(ctx.session.layout);
          const nextLayout = normalizeWorkspaceLayout({ ...current, ...partial });
          return {
            ...ctx,
            session: {
              ...ctx.session,
              layout: nextLayout,
            },
          };
        }),
      );
    },
    setProjectPanelCollapsed(projectPanelCollapsed: boolean) {
      slice.updateActiveWorkspaceLayout({ projectPanelCollapsed });
    },
    setSessionsSidebarCollapsed(sessionsSidebarCollapsed: boolean) {
      slice.updateActiveWorkspaceLayout({ sessionsSidebarCollapsed });
    },
    reorderWorkspaces(fromIndex: number, toIndex: number) {
      update((state) => {
        const workspaces = moveArrayItem(state.contexts.workspaces, fromIndex, toIndex);
        if (workspaces === state.contexts.workspaces) {
          return state;
        }
        return {
          ...state,
          contexts: {
            ...state.contexts,
            workspaces,
          },
        };
      });
    },
  };

  return slice;
}
