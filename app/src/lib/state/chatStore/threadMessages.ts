import type { ChatMessage, ToolCallRecord } from "../../domain/contracts";
import { compactChatThread } from "../../services/chatRetention";
import { createThreadMetadata, cloneThread } from "./threadHelpers";
import type { ChatStoreState } from "./types";
import {
  createAgentId,
  ensureActiveAgent,
  findAgentIndexEntry,
  isDraftAgentEntry,
  patchAgentIndexEntry,
  promoteDraftAgentIndexEntry,
  resolveTargetAgentId,
} from "./agents";
import { patchWorkspaceState, resolveWorkspaceRoot, threadForAgent } from "./workspace";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createThreadMessagesSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
}) {
  const { update, getSnapshot } = deps;

  return {
    appendMessage(
      message: ChatMessage,
      options?: { agentId?: string; skipCompaction?: boolean },
    ): boolean {
      let appended = false;
      update((state) => {
        const root = state.activeChatScopeKey;
        if (!root) {
          return state;
        }

        const access = state.accessByWorkspace[root];
        if (access?.status === "blocked" && message.role === "user") {
          return state;
        }

        let agentId = resolveTargetAgentId(state, options?.agentId);
        let workingState = state;
        let workspace = state.workspaces[root];

        if (!agentId) {
          if (message.role !== "user") {
            return state;
          }
          const ensured = ensureActiveAgent(state);
          if (!ensured) {
            return state;
          }
          workingState = ensured.state;
          workspace = ensured.workspace;
          agentId = ensured.agentId;
        }

        if (!workspace || !agentId) {
          return state;
        }

        const existingThread = workspace.threadsByAgentId[agentId] ?? null;
        if (!existingThread && message.role !== "user") {
          return state;
        }

        const thread = cloneThread(existingThread) ?? {
          metadata: createThreadMetadata(agentId, message.createdAt),
          messages: [],
        };
        thread.messages = [...thread.messages, { ...message }];
        thread.metadata = {
          ...thread.metadata,
          updatedAt: message.createdAt,
        };
        const nextThread = options?.skipCompaction ? thread : compactChatThread(thread).thread;

        let nextAgentIndex = workspace.agentIndex;
        if (message.role === "user") {
          const userMessageCount = nextThread.messages.filter((entry) => entry.role === "user").length;
          const indexEntry = findAgentIndexEntry(workspace, agentId);
          if (userMessageCount === 1 && isDraftAgentEntry(indexEntry)) {
            nextAgentIndex = patchAgentIndexEntry(
              workspace.agentIndex,
              agentId,
              promoteDraftAgentIndexEntry(indexEntry!, message.content, message.createdAt),
            );
          } else if (indexEntry) {
            nextAgentIndex = patchAgentIndexEntry(workspace.agentIndex, agentId, {
              ...indexEntry,
              lastUsedAt: message.createdAt,
            });
          }
        }

        appended = true;
        return patchWorkspaceState(workingState, root, {
          ...workspace,
          activeAgentId: workspace.activeAgentId ?? agentId,
          agentIndex: nextAgentIndex,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [agentId]: nextThread,
          },
        });
      });
      return appended;
    },
    updateMessageContent(
      messageId: string,
      content: string,
      agentId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      let updated = false;
      update((state) => {
        const root = resolveWorkspaceRoot(state, workspaceRoot);
        const targetAgentId = resolveTargetAgentId(state, agentId);
        if (!root || !targetAgentId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsByAgentId[targetAgentId];
        if (!thread) {
          return state;
        }

        const messageIndex = thread.messages.findIndex((entry) => entry.id === messageId);
        if (messageIndex === -1) {
          return state;
        }

        const nextThread = cloneThread(thread);
        if (!nextThread) {
          return state;
        }
        const updatedAt = new Date().toISOString();
        nextThread.messages = nextThread.messages.map((entry, index) =>
          index === messageIndex ? { ...entry, content } : entry,
        );
        nextThread.metadata = {
          ...nextThread.metadata,
          updatedAt,
        };
        updated = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [targetAgentId]: nextThread,
          },
        });
      });
      return updated;
    },
    removeMessage(messageId: string, agentId?: string, workspaceRoot?: string | null): boolean {
      let removed = false;
      update((state) => {
        const root = resolveWorkspaceRoot(state, workspaceRoot);
        const targetAgentId = resolveTargetAgentId(state, agentId);
        if (!root || !targetAgentId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsByAgentId[targetAgentId];
        if (!thread) {
          return state;
        }
        if (!thread.messages.some((entry) => entry.id === messageId)) {
          return state;
        }

        const nextThread = cloneThread(thread);
        if (!nextThread) {
          return state;
        }
        const updatedAt = new Date().toISOString();
        nextThread.messages = nextThread.messages.filter((entry) => entry.id !== messageId);
        nextThread.metadata = {
          ...nextThread.metadata,
          updatedAt,
        };
        removed = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [targetAgentId]: nextThread,
          },
        });
      });
      return removed;
    },
    compactActiveThread(agentId?: string): boolean {
      let compacted = false;
      update((state) => {
        const root = state.activeChatScopeKey;
        const targetAgentId = resolveTargetAgentId(state, agentId);
        if (!root || !targetAgentId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsByAgentId[targetAgentId];
        if (!thread) {
          return state;
        }
        const result = compactChatThread(thread);
        compacted = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [targetAgentId]: result.thread,
          },
        });
      });
      return compacted;
    },
    updateMessageToolCalls(
      messageId: string,
      toolCalls: ToolCallRecord[],
      agentId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      let updated = false;
      update((state) => {
        const root = resolveWorkspaceRoot(state, workspaceRoot);
        const targetAgentId = resolveTargetAgentId(state, agentId);
        if (!root || !targetAgentId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsByAgentId[targetAgentId];
        if (!thread) {
          return state;
        }

        const messageIndex = thread.messages.findIndex((entry) => entry.id === messageId);
        if (messageIndex === -1) {
          return state;
        }

        const nextThread = cloneThread(thread);
        if (!nextThread) {
          return state;
        }
        const updatedAt = new Date().toISOString();
        nextThread.messages = nextThread.messages.map((entry, index) =>
          index === messageIndex ? { ...entry, toolCalls } : entry,
        );
        nextThread.metadata = {
          ...nextThread.metadata,
          updatedAt,
        };
        updated = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [targetAgentId]: nextThread,
          },
        });
      });
      return updated;
    },
    getMessages(agentId?: string): ChatMessage[] {
      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      const thread = threadForAgent(getSnapshot(), targetAgentId);
      return thread?.messages ?? [];
    },
  };
}
