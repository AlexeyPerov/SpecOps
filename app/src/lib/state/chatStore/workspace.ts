import type { ChatThreadSnapshot } from "../../domain/contracts";
import type { ChatStoreState, WorkspaceAgentsState } from "./types";

export const initialWorkspaceAgentsState = (): WorkspaceAgentsState => ({
  activeAgentId: null,
  agentIndex: [],
  threadsByAgentId: {},
  runtimeByAgentId: {},
});

export function workspaceState(
  state: ChatStoreState,
  root: string | null,
): WorkspaceAgentsState | null {
  if (!root) {
    return null;
  }
  return state.workspaces[root] ?? null;
}

export function getOrCreateWorkspaceState(
  state: ChatStoreState,
  root: string,
): { nextState: ChatStoreState; workspace: WorkspaceAgentsState } {
  const existing = state.workspaces[root];
  if (existing) {
    return { nextState: state, workspace: existing };
  }
  const workspace = initialWorkspaceAgentsState();
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
  patch: WorkspaceAgentsState,
): ChatStoreState {
  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [root]: patch,
    },
  };
}

export function activeAgentId(state: ChatStoreState): string | null {
  return workspaceState(state, state.activeChatScopeKey)?.activeAgentId ?? null;
}

export function threadForAgent(
  state: ChatStoreState,
  agentId: string | null,
): ChatThreadSnapshot | null {
  const scopeKey = state.activeChatScopeKey;
  if (!scopeKey || !agentId) {
    return null;
  }
  return state.workspaces[scopeKey]?.threadsByAgentId[agentId] ?? null;
}

export function activeThread(state: ChatStoreState): ChatThreadSnapshot | null {
  return threadForAgent(state, activeAgentId(state));
}

export function resolveChatScopeKey(
  state: ChatStoreState,
  scopeKey?: string | null,
): string | null {
  return scopeKey ?? state.activeChatScopeKey;
}
