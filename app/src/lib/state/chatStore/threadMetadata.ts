import type { ChatThreadMetadata, ChatThreadSnapshot } from "../../domain/contracts";
import { normalizeThreadSnapshotForScope } from "../../ai/providers/threadScopeNormalization";
import { draftEntryTitleForScope } from "../../services/chatAgents";
import { createThreadMetadata, cloneThread, applyMetadataPatch } from "./threadHelpers";
import type { ChatStoreState } from "./types";
import { createAgentId, ensureActiveAgent, resolveTargetAgentId } from "./agents";
import { getOrCreateWorkspaceState, patchWorkspaceState, threadForAgent } from "./workspace";

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
    setAgentThread(agentId: string, thread: ChatThreadSnapshot | null): void {
      const root = getActiveChatScopeKey();
      if (!root) {
        return;
      }
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [agentId]: normalizeThreadForScope(cloneThread(thread), root),
          },
        });
      });
    },
    /** @deprecated Use setAgentThread + setActiveAgentId. Kept for transitional callers. */
    setWorkspaceThread(normalizedRootPath: string, thread: ChatThreadSnapshot | null): void {
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, normalizedRootPath);
        const agentId = thread?.metadata.agentId ?? workspace.activeAgentId ?? createAgentId();
        const nextIndex = workspace.agentIndex.some((entry) => entry.id === agentId)
          ? workspace.agentIndex
          : [
              ...workspace.agentIndex,
              {
                id: agentId,
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
              activeAgentId: agentId,
              agentIndex: nextIndex,
              threadsByAgentId: {
                ...workspace.threadsByAgentId,
                [agentId]: normalizeThreadForScope(cloneThread(thread), normalizedRootPath),
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
      agentId?: string,
    ): boolean {
      let updatedMetadata = false;
      update((state) => {
        const root = state.activeChatScopeKey;
        if (!root) {
          return state;
        }

        let workingState = state;
        let workspace = state.workspaces[root];
        let targetAgentId = resolveTargetAgentId(state, agentId);

        if (!targetAgentId) {
          const ensured = ensureActiveAgent(state);
          if (!ensured) {
            return state;
          }
          workingState = ensured.state;
          workspace = ensured.workspace;
          targetAgentId = ensured.agentId;
        }

        if (!workspace || !targetAgentId) {
          return state;
        }

        const thread = workspace.threadsByAgentId[targetAgentId];
        if (!thread) {
          updatedMetadata = true;
          return patchWorkspaceState(workingState, root, {
            ...workspace,
            activeAgentId: workspace.activeAgentId ?? targetAgentId,
            threadsByAgentId: {
              ...workspace.threadsByAgentId,
              [targetAgentId]: {
                metadata: applyMetadataPatch(
                  createThreadMetadata(targetAgentId, updatedAt, root),
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
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [targetAgentId]: {
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
    getActiveThreadSnapshot(agentId?: string): ChatThreadSnapshot | null {
      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      return cloneThread(threadForAgent(getSnapshot(), targetAgentId));
    },
    getMetadata(agentId?: string): ChatThreadMetadata | null {
      const thread = threadForAgent(
        getSnapshot(),
        resolveTargetAgentId(getSnapshot(), agentId),
      );
      return thread?.metadata ?? null;
    },
    hasThread(agentId?: string): boolean {
      return this.getMetadata(agentId) !== null;
    },
    isEmpty(agentId?: string): boolean {
      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      const thread = threadForAgent(getSnapshot(), targetAgentId);
      return (thread?.messages.length ?? 0) === 0;
    },
  };
}
