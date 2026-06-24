import type { ChatStoreState, ChatThreadRuntimeState, ChatTurnError } from "./types";
import {
  getOrCreateWorkspaceState,
  patchWorkspaceState,
  resolveChatScopeKey,
} from "./workspace";
import { resolveTargetSessionId } from "./sessions";
import { activeSessionId } from "./workspace";
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

export function runtimeForSessionInWorkspace(
  state: ChatStoreState,
  workspaceRoot: string | null,
  sessionId: string | null,
): ChatThreadRuntimeState {
  if (!workspaceRoot || !sessionId) {
    return defaultRuntimeState();
  }
  return state.workspaces[workspaceRoot]?.runtimeBySessionId[sessionId] ?? defaultRuntimeState();
}

export function runtimeForSession(state: ChatStoreState, sessionId: string | null): ChatThreadRuntimeState {
  return runtimeForSessionInWorkspace(state, state.activeChatScopeKey, sessionId);
}

export function activeRuntime(state: ChatStoreState): ChatThreadRuntimeState {
  return runtimeForSession(state, activeSessionId(state));
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

  function updateSessionRuntime(
    sessionId: string,
    updater: (runtime: ChatThreadRuntimeState) => ChatThreadRuntimeState,
    workspaceRoot?: string | null,
  ): boolean {
    let updated = false;
    update((state) => {
      const root = resolveChatScopeKey(state, workspaceRoot);
      if (!root) {
        return state;
      }
      const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
      const current = workspace.runtimeBySessionId[sessionId] ?? defaultRuntimeState();
      updated = true;
      return patchWorkspaceState(nextState, root, {
        ...workspace,
        runtimeBySessionId: {
          ...workspace.runtimeBySessionId,
          [sessionId]: updater(current),
        },
      });
    });
    return updated;
  }

  return {
    getRuntimeState(sessionId?: string, workspaceRoot?: string | null): ChatThreadRuntimeState {
      const snapshot = getSnapshot();
      const root = resolveChatScopeKey(snapshot, workspaceRoot);
      const targetSessionId =
        sessionId ?? (root ? (snapshot.workspaces[root]?.activeSessionId ?? null) : null);
      return { ...runtimeForSessionInWorkspace(snapshot, root, targetSessionId) };
    },
    isGenerationTurnActive(workspaceRoot: string, sessionId: string, turnId: string): boolean {
      const runtime = runtimeForSessionInWorkspace(getSnapshot(), workspaceRoot, sessionId);
      return runtime.isGenerating && runtime.activeTurnId === turnId;
    },
    cancelSessionGeneration(workspaceRoot: string, sessionId: string): boolean {
      let cancelled = false;
      update((state) => {
        const workspace = state.workspaces[workspaceRoot];
        if (!workspace) {
          return state;
        }
        const runtime = workspace.runtimeBySessionId[sessionId] ?? defaultRuntimeState();
        if (!runtime.isGenerating) {
          return state;
        }

        cancelled = true;
        const turnId = runtime.activeTurnId;
        let threadsBySessionId = workspace.threadsBySessionId;
        if (turnId) {
          const thread = workspace.threadsBySessionId[sessionId];
          if (thread) {
            const placeholderId = assistantPlaceholderId(turnId);
            const nextMessages = thread.messages.filter((entry) => entry.id !== placeholderId);
            if (nextMessages.length !== thread.messages.length) {
              const updatedAt = new Date().toISOString();
              threadsBySessionId = {
                ...threadsBySessionId,
                [sessionId]: {
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
          threadsBySessionId,
          runtimeBySessionId: {
            ...workspace.runtimeBySessionId,
            [sessionId]: defaultRuntimeState(),
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
      const sessionIds = new Set<string>([
        ...Object.keys(workspace.runtimeBySessionId),
        ...workspace.sessionIndex.map((entry) => entry.id),
      ]);
      const cancelled: string[] = [];
      for (const sessionId of sessionIds) {
        if (this.cancelSessionGeneration(workspaceRoot, sessionId)) {
          cancelled.push(sessionId);
        }
      }
      return cancelled;
    },
    beginTurn(turnId: string, sessionId?: string): boolean {
      const root = getActiveChatScopeKey();
      if (!root) {
        return false;
      }
      const targetSessionId = resolveTargetSessionId(getSnapshot(), sessionId);
      if (!targetSessionId) {
        return false;
      }
      const runtime = runtimeForSession(getSnapshot(), targetSessionId);
      if (runtime.isGenerating) {
        return false;
      }
      return updateSessionRuntime(targetSessionId, () => ({
        isGenerating: true,
        isWaitingForPermission: false,
        isWaitingForQuestion: false,
        activeTurnId: turnId,
        lastFailedTurnId: null,
        lastError: null,
      }));
    },
    completeTurn(sessionId?: string, workspaceRoot?: string | null): boolean {
      const snapshot = getSnapshot();
      const root = resolveChatScopeKey(snapshot, workspaceRoot);
      const targetSessionId = resolveTargetSessionId(snapshot, sessionId);
      if (!root || !targetSessionId) {
        return false;
      }
      const runtime = runtimeForSessionInWorkspace(snapshot, root, targetSessionId);
      if (!runtime.isGenerating) {
        return false;
      }
      return updateSessionRuntime(targetSessionId, () => defaultRuntimeState(), root);
    },
    failTurn(
      error: ChatTurnError,
      turnId?: string,
      sessionId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      const snapshot = getSnapshot();
      const root = resolveChatScopeKey(snapshot, workspaceRoot);
      const targetSessionId = resolveTargetSessionId(snapshot, sessionId);
      if (!root || !targetSessionId) {
        return false;
      }
      const runtime = runtimeForSessionInWorkspace(snapshot, root, targetSessionId);
      const failedTurnId = turnId ?? runtime.activeTurnId;
      if (!failedTurnId) {
        return false;
      }
      return updateSessionRuntime(
        targetSessionId,
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
    canRetryLastTurn(sessionId?: string): boolean {
      const runtime = this.getRuntimeState(sessionId);
      return runtime.lastFailedTurnId !== null && !runtime.isGenerating;
    },
    setWaitingForPermission(sessionId: string, waiting: boolean, workspaceRoot?: string | null): boolean {
      return updateSessionRuntime(sessionId, (current) => ({
        ...current,
        isWaitingForPermission: waiting,
      }), workspaceRoot);
    },
    setWaitingForQuestion(sessionId: string, waiting: boolean, workspaceRoot?: string | null): boolean {
      return updateSessionRuntime(sessionId, (current) => ({
        ...current,
        isWaitingForQuestion: waiting,
      }), workspaceRoot);
    },
  };
}
