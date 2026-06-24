import type { ChatThreadMetadata, ChatThreadSnapshot } from "../../domain/contracts";
import { normalizeThreadSnapshotForScope } from "../../ai/providers/threadScopeNormalization";
import { draftEntryTitleForScope } from "../../services/chatSessions";
import { createThreadMetadata, cloneThread, applyMetadataPatch } from "./threadHelpers";
import type { ChatStoreState } from "./types";
import { createSessionId, ensureActiveSession, resolveTargetSessionId } from "./sessions";
import { getOrCreateWorkspaceState, patchWorkspaceState, threadForSession } from "./workspace";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

function normalizeThreadForScope(
  thread: ChatThreadSnapshot | null,
  scopeKey: string,
): ChatThreadSnapshot | null {
  return normalizeThreadSnapshotForScope(thread, scopeKey);
}

function normalizeMetadataPatchForScope(
  patch: Partial<
    Pick<
      ChatThreadMetadata,
      | "mode"
      | "provider"
      | "summary"
      | "selectedModelId"
      | "connectionId"
      | "opencodeAgentId"
      | "opencodeProviderId"
    >
  >,
  _scopeKey: string,
): Partial<
  Pick<
    ChatThreadMetadata,
    | "mode"
    | "provider"
    | "summary"
    | "selectedModelId"
    | "connectionId"
    | "opencodeAgentId"
    | "opencodeProviderId"
  >
> {
  return patch;
}

export function createThreadMetadataSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
}) {
  const { update, getSnapshot, getActiveChatScopeKey } = deps;

  return {
    setSessionThread(sessionId: string, thread: ChatThreadSnapshot | null): void {
      const root = getActiveChatScopeKey();
      if (!root) {
        return;
      }
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [sessionId]: normalizeThreadForScope(cloneThread(thread), root),
          },
        });
      });
    },
    /** @deprecated Use setSessionThread + setActiveSessionId. Kept for transitional callers. */
    setWorkspaceThread(normalizedRootPath: string, thread: ChatThreadSnapshot | null): void {
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, normalizedRootPath);
        const sessionId = thread?.metadata.sessionId ?? workspace.activeSessionId ?? createSessionId();
        const nextIndex = workspace.sessionIndex.some((entry) => entry.id === sessionId)
          ? workspace.sessionIndex
          : [
              ...workspace.sessionIndex,
              {
                id: sessionId,
                title: draftEntryTitleForScope(normalizedRootPath),
                lastUsedAt: thread?.metadata.updatedAt ?? new Date().toISOString(),
                isDraft: !thread || thread.messages.length === 0,
              },
            ];
        return {
          ...state,
          activeChatScopeKey: normalizedRootPath,
          workspaces: {
            ...nextState.workspaces,
            [normalizedRootPath]: {
              ...workspace,
              activeSessionId: sessionId,
              sessionIndex: nextIndex,
              threadsBySessionId: {
                ...workspace.threadsBySessionId,
                [sessionId]: normalizeThreadForScope(cloneThread(thread), normalizedRootPath),
              },
            },
          },
        };
      });
    },
    updateThreadMetadata(
      patch: Partial<
        Pick<
          ChatThreadMetadata,
          | "mode"
          | "provider"
          | "summary"
          | "selectedModelId"
          | "connectionId"
          | "opencodeAgentId"
          | "opencodeProviderId"
        >
      >,
      updatedAt: string = new Date().toISOString(),
      sessionId?: string,
    ): boolean {
      let updatedMetadata = false;
      update((state) => {
        const root = state.activeChatScopeKey;
        if (!root) {
          return state;
        }

        let workingState = state;
        let workspace = state.workspaces[root];
        let targetSessionId = resolveTargetSessionId(state, sessionId);

        if (!targetSessionId) {
          const ensured = ensureActiveSession(state);
          if (!ensured) {
            return state;
          }
          workingState = ensured.state;
          workspace = ensured.workspace;
          targetSessionId = ensured.sessionId;
        }

        if (!workspace || !targetSessionId) {
          return state;
        }

        const thread = workspace.threadsBySessionId[targetSessionId];
        if (!thread) {
          updatedMetadata = true;
          return patchWorkspaceState(workingState, root, {
            ...workspace,
            activeSessionId: workspace.activeSessionId ?? targetSessionId,
            threadsBySessionId: {
              ...workspace.threadsBySessionId,
              [targetSessionId]: {
                metadata: applyMetadataPatch(
                  createThreadMetadata(targetSessionId, updatedAt, root),
                  normalizeMetadataPatchForScope(patch, root),
                  updatedAt,
                ),
                messages: [],
              },
            },
          });
        }

        updatedMetadata = true;
        return patchWorkspaceState(workingState, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: {
              ...thread,
              metadata: applyMetadataPatch(
                thread.metadata,
                normalizeMetadataPatchForScope(patch, root),
                updatedAt,
              ),
            },
          },
        });
      });
      return updatedMetadata;
    },
    getActiveThreadSnapshot(sessionId?: string): ChatThreadSnapshot | null {
      const targetSessionId = resolveTargetSessionId(getSnapshot(), sessionId);
      return cloneThread(threadForSession(getSnapshot(), targetSessionId));
    },
    getMetadata(sessionId?: string): ChatThreadMetadata | null {
      const thread = threadForSession(
        getSnapshot(),
        resolveTargetSessionId(getSnapshot(), sessionId),
      );
      return thread?.metadata ?? null;
    },
    hasThread(sessionId?: string): boolean {
      return this.getMetadata(sessionId) !== null;
    },
    isEmpty(sessionId?: string): boolean {
      const targetSessionId = resolveTargetSessionId(getSnapshot(), sessionId);
      const thread = threadForSession(getSnapshot(), targetSessionId);
      return (thread?.messages.length ?? 0) === 0;
    },
  };
}
