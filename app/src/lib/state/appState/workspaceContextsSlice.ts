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
  totalTabCount,
  createFileTab,
  createSinglePaneLayout,
  ensureUniquePaneIds,
} from "../../domain/contracts";
import { normalizePathForStorage } from "../../services/diskFingerprint";
import {
  DEFAULT_ACTIVITY_RAIL_WIDTH_PX,
  defaultWorkspaceLayout,
  normalizeActivityRailWidthPx,
  normalizeWorkspaceLayout,
} from "../../services/panelLayout";
import {
  cloneContextSnapshot,
  findWorkspaceByPath,
  getActiveContextSnapshot,
  getActiveDocuments,
  getActiveSession,
  nextDocAndTabIds,
  nextWorkspaceId,
  normalizeWorkspaceEntries,
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
  // A split may deliberately leave its active pane empty while another pane
  // owns open tabs. Checking only the active pane here would replace the whole
  // restored context with a fresh draft and discard those sibling panes.
  const layout = ensureUniquePaneIds(snapshot.session.editorLayout);
  const withUniquePanes =
    layout === snapshot.session.editorLayout
      ? snapshot
      : {
          ...snapshot,
          session: { ...snapshot.session, editorLayout: layout },
        };
  if (totalTabCount(withUniquePanes.session.editorLayout) > 0) {
    return withUniquePanes;
  }
  return fallbackContextSnapshot(withUniquePanes.session.lastActiveWindowId);
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
      if (targetId === NOTEPAD_CONTEXT_ID) {
        return null;
      }
      return state.contexts.workspaces.find((workspace) => workspace.id === targetId)?.rootPath ?? null;
    },
    switchContext(contextId: ContextId): boolean {
      let switched = false;
      update((state) => {
        const exists =
          contextId === NOTEPAD_CONTEXT_ID ||
          state.contexts.workspaces.some((workspace) => workspace.id === contextId);
        if (!exists || state.contexts.activeContextId === contextId) {
          return state;
        }
        switched = true;
        // Heal duplicate pane ids in the destination before activating so a
        // corrupt notepad/workspace layout cannot freeze the editor grid.
        let nextContexts = state.contexts;
        if (contextId === NOTEPAD_CONTEXT_ID) {
          const healed = ensureContextSnapshotHasTab(state.contexts.notepad);
          if (healed !== state.contexts.notepad) {
            nextContexts = { ...nextContexts, notepad: healed };
          }
        } else {
          let workspacesChanged = false;
          const workspaces = state.contexts.workspaces.map((workspace) => {
            if (workspace.id !== contextId) {
              return workspace;
            }
            const healed = ensureContextSnapshotHasTab(workspace.snapshot);
            if (healed === workspace.snapshot) {
              return workspace;
            }
            workspacesChanged = true;
            return { ...workspace, snapshot: healed };
          });
          if (workspacesChanged) {
            nextContexts = { ...nextContexts, workspaces };
          }
        }
        return {
          ...state,
          contexts: {
            ...nextContexts,
            activeContextId: contextId,
          },
          editor: {
            ...state.editor,
            previewMode: "editor",
          },
        };
      });
      return switched;
    },
    addWorkspace(rootPath: string): ContextId | null {
      let createdId: ContextId | null = null;
      update((state) => {
        // Persist the real casing; only the duplicate check folds case.
        const storedRoot = normalizePathForStorage(rootPath);
        const duplicate = findWorkspaceByPath(state.contexts.workspaces, storedRoot);
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
                rootPath: storedRoot,
                snapshot: workspaceSnapshot,
              },
            ],
          },
          editor: {
            ...state.editor,
            previewMode: "editor",
          },
        };
      });
      return createdId;
    },
    getWorkspaceDirtyDocuments(workspaceId: ContextId): DocumentState[] {
      const state = getSnapshot();
      const workspace = state.contexts.workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        return [];
      }
      return workspace.snapshot.documents.filter((documentState) => documentState.isDirty);
    },
    /**
     * Remove a workspace from the app state. Confirmation and save-all
     * persistence are the caller's responsibility — this is a pure state
     * transition (no side-effecting callbacks). Returns `true` when the
     * workspace existed and was removed.
     */
    closeWorkspace(workspaceId: ContextId): boolean {
      let closed = false;
      update((state) => {
        const targetWorkspace = state.contexts.workspaces.find((workspace) => workspace.id === workspaceId);
        if (!targetWorkspace) {
          return state;
        }
        closed = true;
        const workspaces = state.contexts.workspaces.filter((workspace) => workspace.id !== workspaceId);
        const closingActiveWorkspace = state.contexts.activeContextId === workspaceId;
        // Workspace order is user-visible and persisted, so the first remaining
        // entry is a deterministic successor when the active workspace closes.
        const activeContextId = closingActiveWorkspace
          ? (workspaces[0]?.id ?? NOTEPAD_CONTEXT_ID)
          : state.contexts.activeContextId;
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId,
            workspaces,
          },
          editor: {
            ...state.editor,
            previewMode: closingActiveWorkspace ? "editor" : state.editor.previewMode,
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
