import type { ChatStoreState, ChatThreadRuntimeState, ChatTurnError } from "./types";
import {
  getOrCreateWorkspaceState,
  patchWorkspaceState,
  resolveWorkspaceRoot,
} from "./workspace";
import { resolveTargetAgentId } from "./agents";
import { activeAgentId } from "./workspace";
export function defaultRuntimeState(): ChatThreadRuntimeState {
  return {
    isGenerating: false,
    isWaitingForPermission: false,
    isWaitingForQuestion: false,
    lastFailedTurnId: null,
    lastError: null,
    activeTurnId: null,
  };
}

export function runtimeForAgentInWorkspace(
  state: ChatStoreState,
  workspaceRoot: string | null,
  agentId: string | null,
): ChatThreadRuntimeState {
  if (!workspaceRoot || !agentId) {
    return defaultRuntimeState();
  }
  return state.workspaces[workspaceRoot]?.runtimeByAgentId[agentId] ?? defaultRuntimeState();
}

export function runtimeForAgent(state: ChatStoreState, agentId: string | null): ChatThreadRuntimeState {
  return runtimeForAgentInWorkspace(state, state.activeChatScopeKey, agentId);
}

export function activeRuntime(state: ChatStoreState): ChatThreadRuntimeState {
  return runtimeForAgent(state, activeAgentId(state));
}

export function assistantPlaceholderId(turnId: string): string {
  return `assistant-${turnId}`;
}

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createRuntimeSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
}) {
  const { update, getSnapshot, getActiveChatScopeKey } = deps;

  function updateAgentRuntime(
    agentId: string,
    updater: (runtime: ChatThreadRuntimeState) => ChatThreadRuntimeState,
    workspaceRoot?: string | null,
  ): boolean {
    let updated = false;
    update((state) => {
      const root = resolveWorkspaceRoot(state, workspaceRoot);
      if (!root) {
        return state;
      }
      const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
      const current = workspace.runtimeByAgentId[agentId] ?? defaultRuntimeState();
      updated = true;
      return patchWorkspaceState(nextState, root, {
        ...workspace,
        runtimeByAgentId: {
          ...workspace.runtimeByAgentId,
          [agentId]: updater(current),
        },
      });
    });
    return updated;
  }

  return {
    getRuntimeState(agentId?: string, workspaceRoot?: string | null): ChatThreadRuntimeState {
      const snapshot = getSnapshot();
      const root = resolveWorkspaceRoot(snapshot, workspaceRoot);
      const targetAgentId =
        agentId ?? (root ? (snapshot.workspaces[root]?.activeAgentId ?? null) : null);
      return { ...runtimeForAgentInWorkspace(snapshot, root, targetAgentId) };
    },
    isGenerationTurnActive(workspaceRoot: string, agentId: string, turnId: string): boolean {
      const runtime = runtimeForAgentInWorkspace(getSnapshot(), workspaceRoot, agentId);
      return runtime.isGenerating && runtime.activeTurnId === turnId;
    },
    cancelAgentGeneration(workspaceRoot: string, agentId: string): boolean {
      let cancelled = false;
      update((state) => {
        const workspace = state.workspaces[workspaceRoot];
        if (!workspace) {
          return state;
        }
        const runtime = workspace.runtimeByAgentId[agentId] ?? defaultRuntimeState();
        if (!runtime.isGenerating) {
          return state;
        }

        cancelled = true;
        const turnId = runtime.activeTurnId;
        let threadsByAgentId = workspace.threadsByAgentId;
        if (turnId) {
          const thread = workspace.threadsByAgentId[agentId];
          if (thread) {
            const placeholderId = assistantPlaceholderId(turnId);
            const nextMessages = thread.messages.filter((entry) => entry.id !== placeholderId);
            if (nextMessages.length !== thread.messages.length) {
              const updatedAt = new Date().toISOString();
              threadsByAgentId = {
                ...threadsByAgentId,
                [agentId]: {
                  ...thread,
                  messages: nextMessages,
                  metadata: {
                    ...thread.metadata,
                    updatedAt,
                  },
                },
              };
            }
          }
        }

        return patchWorkspaceState(state, workspaceRoot, {
          ...workspace,
          threadsByAgentId,
          runtimeByAgentId: {
            ...workspace.runtimeByAgentId,
            [agentId]: defaultRuntimeState(),
          },
        });
      });
      return cancelled;
    },
    cancelAllGenerations(workspaceRoot: string): string[] {
      const workspace = getSnapshot().workspaces[workspaceRoot];
      if (!workspace) {
        return [];
      }
      const agentIds = new Set<string>([
        ...Object.keys(workspace.runtimeByAgentId),
        ...workspace.agentIndex.map((entry) => entry.id),
      ]);
      const cancelled: string[] = [];
      for (const agentId of agentIds) {
        if (this.cancelAgentGeneration(workspaceRoot, agentId)) {
          cancelled.push(agentId);
        }
      }
      return cancelled;
    },
    beginTurn(turnId: string, agentId?: string): boolean {
      const root = getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      if (!targetAgentId) {
        return false;
      }
      const runtime = runtimeForAgent(getSnapshot(), targetAgentId);
      if (runtime.isGenerating) {
        return false;
      }
      return updateAgentRuntime(targetAgentId, () => ({
        isGenerating: true,
        isWaitingForPermission: false,
        isWaitingForQuestion: false,
        activeTurnId: turnId,
        lastFailedTurnId: null,
        lastError: null,
      }));
    },
    completeTurn(agentId?: string, workspaceRoot?: string | null): boolean {
      const snapshot = getSnapshot();
      const root = resolveWorkspaceRoot(snapshot, workspaceRoot);
      const targetAgentId = resolveTargetAgentId(snapshot, agentId);
      if (!root || !targetAgentId) {
        return false;
      }
      const runtime = runtimeForAgentInWorkspace(snapshot, root, targetAgentId);
      if (!runtime.isGenerating) {
        return false;
      }
      return updateAgentRuntime(targetAgentId, () => defaultRuntimeState(), root);
    },
    failTurn(
      error: ChatTurnError,
      turnId?: string,
      agentId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      const snapshot = getSnapshot();
      const root = resolveWorkspaceRoot(snapshot, workspaceRoot);
      const targetAgentId = resolveTargetAgentId(snapshot, agentId);
      if (!root || !targetAgentId) {
        return false;
      }
      const runtime = runtimeForAgentInWorkspace(snapshot, root, targetAgentId);
      const failedTurnId = turnId ?? runtime.activeTurnId;
      if (!failedTurnId) {
        return false;
      }
      return updateAgentRuntime(
        targetAgentId,
        () => ({
          isGenerating: false,
          isWaitingForPermission: false,
          isWaitingForQuestion: false,
          activeTurnId: null,
          lastFailedTurnId: failedTurnId,
          lastError: { ...error },
        }),
        root,
      );
    },
    canRetryLastTurn(agentId?: string): boolean {
      const runtime = this.getRuntimeState(agentId);
      return runtime.lastFailedTurnId !== null && !runtime.isGenerating;
    },
    setWaitingForPermission(agentId: string, waiting: boolean, workspaceRoot?: string | null): boolean {
      return updateAgentRuntime(agentId, (current) => ({
        ...current,
        isWaitingForPermission: waiting,
      }), workspaceRoot);
    },
    setWaitingForQuestion(agentId: string, waiting: boolean, workspaceRoot?: string | null): boolean {
      return updateAgentRuntime(agentId, (current) => ({
        ...current,
        isWaitingForQuestion: waiting,
      }), workspaceRoot);
    },
  };
}
