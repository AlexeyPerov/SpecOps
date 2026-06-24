import type { ChatThreadSnapshot } from "../../domain/contracts";
import type { ChatStoreState, WorkspaceSessionsState } from "./types";

export const initialWorkspaceSessionsState = (): WorkspaceSessionsState => ({
  activeSessionId: null,
  sessionIndex: [],
  threadsBySessionId: {},
  runtimeBySessionId: {},
});

export function workspaceState(
  state: ChatStoreState,
  root: string | null,
): WorkspaceSessionsState | null {
  if (!root) {
    return null;
  }
  return state.workspaces[root] ?? null;
}

export function getOrCreateWorkspaceState(
  state: ChatStoreState,
  root: string,
): { nextState: ChatStoreState; workspace: WorkspaceSessionsState } {
  const existing = state.workspaces[root];
  if (existing) {
    return { nextState: state, workspace: existing };
  }
  const workspace = initialWorkspaceSessionsState();
  return {
    nextState: {
      ...state,
      workspaces: {
        ...state.workspaces,
        [root]: workspace,
      },
    },
    workspace,
  };
}

export function patchWorkspaceState(
  state: ChatStoreState,
  root: string,
  patch: WorkspaceSessionsState,
): ChatStoreState {
  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [root]: patch,
    },
  };
}

export function activeSessionId(state: ChatStoreState): string | null {
  return workspaceState(state, state.activeChatScopeKey)?.activeSessionId ?? null;
}

export function threadForSession(
  state: ChatStoreState,
  sessionId: string | null,
): ChatThreadSnapshot | null {
  const scopeKey = state.activeChatScopeKey;
  if (!scopeKey || !sessionId) {
    return null;
  }
  return state.workspaces[scopeKey]?.threadsBySessionId[sessionId] ?? null;
}

export function activeThread(state: ChatStoreState): ChatThreadSnapshot | null {
  return threadForSession(state, activeSessionId(state));
}

export function resolveChatScopeKey(
  state: ChatStoreState,
  scopeKey?: string | null,
): string | null {
  return scopeKey ?? state.activeChatScopeKey;
}
