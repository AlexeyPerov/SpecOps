import type {
  AppDomainState,
  AppThemeState,
  ContextId,
  ContextSnapshot,
  DocumentState,
  TabGroupEntry,
  TabGroupId,
  WindowBounds,
  WindowSessionSnapshot,
  WorkspaceLayoutState,
  WorkspaceEntry,
} from "../../domain/contracts";
import {
  totalTabCount,
  createFileTab,
  DEFAULT_TAB_GROUP_ID,
  DEFAULT_TAB_GROUP_NAME,
  findTabGroup,
  isTabGroupId,
  createSinglePaneLayout,
  ensureUniquePaneIds,
  nextPaneId,
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
  getContextSnapshotById,
  nextDocAndTabIds,
  nextDocId,
  nextTabGroupId,
  nextTabId,
  nextWorkspaceId,
  normalizeWorkspaceEntries,
  patchActiveContext,
  patchContextById,
  reindexIdCountersFromContexts,
} from "./contextHelpers";
import { buildEmptyUnsavedDocument } from "./documentHelpers";
import { getProjectCatalog, projectIdentity, recordCatalogProjectUse } from '../../services/workspaceCatalog';
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

function cloneTabGroups(groups: TabGroupEntry[]): TabGroupEntry[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    snapshot: cloneContextSnapshot(group.snapshot),
  }));
}

/** Restored groups keep their order after the default group; a missing default is recreated. */
function restoreTabGroups(groups: TabGroupEntry[], lastActiveWindowId: string): TabGroupEntry[] {
  const restored = cloneTabGroups(groups).map((group) => ({
    ...group,
    name: group.name.trim() || DEFAULT_TAB_GROUP_NAME,
    snapshot: ensureContextSnapshotHasTab(group.snapshot),
  }));
  const defaultGroup = restored.find((group) => group.id === DEFAULT_TAB_GROUP_ID) ?? {
    id: DEFAULT_TAB_GROUP_ID,
    name: DEFAULT_TAB_GROUP_NAME,
    snapshot: fallbackContextSnapshot(lastActiveWindowId),
  };
  return [defaultGroup, ...restored.filter((group) => group.id !== DEFAULT_TAB_GROUP_ID)];
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
      tabGroups: cloneTabGroups(state.contexts.tabGroups),
      workspaces: normalizeWorkspaceEntries(state.contexts.workspaces),
      editorPreferences: {
        zoomPercent: state.editor.zoomPercent,
        wrapLines: state.editor.wrapLines,
      },
      activityRailWidthPx: state.activityRailWidthPx,
    };
  }

  // Last tab group this window activated: files opened while a workspace is
  // active and Tasks/Notes tabs land there.
  let lastTabGroupId: TabGroupId = DEFAULT_TAB_GROUP_ID;
  function targetTabGroupId(state: AppDomainState): TabGroupId {
    const active = state.contexts.activeContextId;
    if (isTabGroupId(active) && findTabGroup(state.contexts.tabGroups, active)) return active;
    return findTabGroup(state.contexts.tabGroups, lastTabGroupId) ? lastTabGroupId : DEFAULT_TAB_GROUP_ID;
  }

  let activationHistory: ContextId[] = [];
  function confirmActivation(contextId: ContextId): void {
    const state = getSnapshot();
    const workspace = state.contexts.workspaces.find(entry => entry.id === contextId);
    if (!workspace || state.contexts.activeContextId !== contextId) return;
    activationHistory = [contextId, ...activationHistory.filter(id => id !== contextId && state.contexts.workspaces.some(entry => entry.id === id))];
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && getProjectCatalog().projects[projectIdentity(workspace.rootPath)]) {
      recordCatalogProjectUse(workspace.rootPath);
    }
  }
  const slice = {
    clearWorkspaceActivationHistory(): void { activationHistory = []; lastTabGroupId = DEFAULT_TAB_GROUP_ID; },
    confirmWorkspaceActivation(contextId: ContextId): void { confirmActivation(contextId); },
    getWorkspaceActivationHistory(): ContextId[] {
      const ids = new Set(getSnapshot().contexts.workspaces.map(entry => entry.id));
      return activationHistory.filter(id => ids.has(id));
    },
    applyWindowSession(snapshot: WindowSessionSnapshot, recentFiles: string[] = []) {
      const preservedSettings = getSnapshot().settings;
      const normalizedWorkspaces = normalizeWorkspaceEntries(snapshot.workspaces).map((workspace) => ({
        ...workspace,
        snapshot: ensureContextSnapshotHasTab(workspace.snapshot),
      }));
      const tabGroups = restoreTabGroups(
        snapshot.tabGroups,
        getActiveSession(getSnapshot()).lastActiveWindowId,
      );
      const activeContextId =
        tabGroups.some((group) => group.id === snapshot.activeContextId) ||
        normalizedWorkspaces.some((workspace) => workspace.id === snapshot.activeContextId)
          ? snapshot.activeContextId
          : DEFAULT_TAB_GROUP_ID;
      const contexts = {
        activeContextId,
        tabGroups,
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
      activationHistory = isTabGroupId(activeContextId) ? [] : [activeContextId];
      lastTabGroupId = isTabGroupId(activeContextId) ? activeContextId : DEFAULT_TAB_GROUP_ID;
      applyTheme(preservedTheme);
    },
    getWindowSessionSnapshot(): WindowSessionSnapshot {
      return toCurrentWindowSnapshot(getSnapshot());
    },
    getActiveContext() {
      const state = getSnapshot();
      if (isTabGroupId(state.contexts.activeContextId)) {
        return {
          id: state.contexts.activeContextId,
          kind: "tabGroup" as const,
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
    isTabGroupActive() {
      return isTabGroupId(getSnapshot().contexts.activeContextId);
    },
    /** The active tab group, else the window's last used group, else the default group. */
    getTargetTabGroupId(): TabGroupId {
      return targetTabGroupId(getSnapshot());
    },
    createTabGroup(name?: string): TabGroupId {
      const id = nextTabGroupId();
      update((state) => {
        const names = new Set(state.contexts.tabGroups.map((group) => group.name));
        let fallbackName = DEFAULT_TAB_GROUP_NAME;
        for (let index = 2; names.has(fallbackName); index += 1) {
          fallbackName = `${DEFAULT_TAB_GROUP_NAME} ${index}`;
        }
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: id,
            tabGroups: [
              ...state.contexts.tabGroups,
              {
                id,
                name: name?.trim() || fallbackName,
                snapshot: fallbackContextSnapshot(getActiveSession(state).lastActiveWindowId),
              },
            ],
          },
          editor: { ...state.editor, previewMode: "editor" },
        };
      });
      lastTabGroupId = id;
      return id;
    },
    renameTabGroup(id: ContextId, name: string): boolean {
      const trimmed = name.trim();
      let renamed = false;
      update((state) => {
        const group = findTabGroup(state.contexts.tabGroups, id);
        if (!trimmed || !group || group.name === trimmed) return state;
        renamed = true;
        return {
          ...state,
          contexts: {
            ...state.contexts,
            tabGroups: state.contexts.tabGroups.map((entry) => entry.id === id ? { ...entry, name: trimmed } : entry),
          },
        };
      });
      return renamed;
    },
    getTabGroupDirtyDocuments(id: ContextId): DocumentState[] {
      const group = findTabGroup(getSnapshot().contexts.tabGroups, id);
      return group?.snapshot.documents.filter((documentState) => documentState.isDirty) ?? [];
    },
    /**
     * Remove a tab group without prompting; unsaved-buffer confirmation is the
     * caller's. The default group cannot be removed. An active group hands
     * focus to the default group.
     */
    removeTabGroup(id: ContextId): boolean {
      if (id === DEFAULT_TAB_GROUP_ID) return false;
      let removed = false;
      update((state) => {
        if (!findTabGroup(state.contexts.tabGroups, id)) return state;
        removed = true;
        const active = state.contexts.activeContextId === id;
        return {
          ...state,
          contexts: {
            ...state.contexts,
            activeContextId: active ? DEFAULT_TAB_GROUP_ID : state.contexts.activeContextId,
            tabGroups: state.contexts.tabGroups.filter((group) => group.id !== id),
          },
          editor: active ? { ...state.editor, previewMode: "editor" } : state.editor,
        };
      });
      if (removed && lastTabGroupId === id) lastTabGroupId = DEFAULT_TAB_GROUP_ID;
      return removed;
    },
    getWorkspaceRoot(contextId?: ContextId): string | null {
      const state = getSnapshot();
      const targetId = contextId ?? state.contexts.activeContextId;
      if (isTabGroupId(targetId)) {
        return null;
      }
      return state.contexts.workspaces.find((workspace) => workspace.id === targetId)?.rootPath ?? null;
    },
    switchContext(contextId: ContextId): boolean {
      let switched = false;
      update((state) => {
        const current = getContextSnapshotById(state, contextId);
        if (!current || state.contexts.activeContextId === contextId) {
          return state;
        }
        switched = true;
        // Heal duplicate pane ids in the destination before activating so a
        // corrupt tab group/workspace layout cannot freeze the editor grid.
        const healed = patchContextById(state, contextId, ensureContextSnapshotHasTab);
        return {
          ...healed,
          contexts: {
            ...healed.contexts,
            activeContextId: contextId,
          },
          editor: {
            ...state.editor,
            previewMode: "editor",
          },
        };
      });
      if (switched) {
        if (isTabGroupId(contextId)) lastTabGroupId = contextId;
        confirmActivation(contextId);
      }
      return switched;
    },
    addWorkspace(rootPath: string, options: { deferActivation?: boolean } = {}): ContextId | null {
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
      if (createdId && !options.deferActivation) confirmActivation(createdId);
      return createdId;
    },
    adoptWorkspace(entry: WorkspaceEntry, windowId: string, options: { deferActivation?: boolean } = {}): ContextId {
      const id = nextWorkspaceId();
      const snapshot = cloneContextSnapshot(entry.snapshot);
      const docs = new Map(snapshot.documents.map(doc => [doc.id, nextDocId()]));
      snapshot.documents = snapshot.documents.map(doc => ({ ...doc, id: docs.get(doc.id)! }));
      const layout = snapshot.session.editorLayout;
      const panes = new Map(layout.panes.map(pane => [pane.id, nextPaneId()]));
      const tabs = new Map(layout.panes.flatMap(pane => pane.tabs.map(tab => [tab.id, nextTabId()] as const)));
      snapshot.session = { ...snapshot.session, lastActiveWindowId: windowId,
        windowBounds: getActiveSession(getSnapshot()).windowBounds,
        editorLayout: { ...layout, activePaneId: panes.get(layout.activePaneId)!,
          panes: layout.panes.map(pane => ({ ...pane, id: panes.get(pane.id)!,
            selectedTabId: pane.selectedTabId ? tabs.get(pane.selectedTabId)! : null,
            tabs: pane.tabs.map(tab => tab.kind === "file" ? { ...tab, id: tabs.get(tab.id)!, documentId: docs.get(tab.documentId)! } : { ...tab, id: tabs.get(tab.id)! }),
          })),
        },
      };
      update(state => ({ ...state, contexts: { ...state.contexts, activeContextId: id, workspaces: [...state.contexts.workspaces, { ...entry, id, snapshot }] } }));
      if (!options.deferActivation) confirmActivation(id);
      return id;
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
     * transition. A real successor activation updates navigation recency;
     * provisional-open rollback can defer it. Returns true after removal.
     */
    closeWorkspace(workspaceId: ContextId, options: { deferActivation?: boolean } = {}): boolean {
      const wasActive = getSnapshot().contexts.activeContextId === workspaceId;
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
          ? (workspaces[0]?.id ?? targetTabGroupId(state))
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
      if (closed) {
        activationHistory = activationHistory.filter(id => id !== workspaceId);
        if (wasActive && !options.deferActivation) confirmActivation(getSnapshot().contexts.activeContextId);
      }
      return closed;
    },
    /** Restore only the removed entry after an ownership-release failure. */
    restoreWorkspaceAfterFailedClose(entry: WorkspaceEntry, index: number, activate: boolean, wasActivated = true): void {
      update(state => {
        if (state.contexts.workspaces.some(workspace => workspace.id === entry.id || findWorkspaceByPath([workspace], entry.rootPath))) return state;
        const workspaces = [...state.contexts.workspaces];
        workspaces.splice(Math.min(index, workspaces.length), 0, entry);
        return { ...state, contexts: { ...state.contexts, workspaces,
          activeContextId: activate ? entry.id : state.contexts.activeContextId } };
      });
      if (activate) confirmActivation(entry.id);
      else if (wasActivated && !activationHistory.includes(entry.id)) activationHistory = [...activationHistory, entry.id];
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
      if (isTabGroupId(state.contexts.activeContextId)) {
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
