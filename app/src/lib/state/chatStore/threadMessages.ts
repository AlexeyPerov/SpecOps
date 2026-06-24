import type { ChatMessage, ChatMessagePart, ToolCallRecord } from "../../domain/contracts";
import { compactChatThread } from "../../services/chatRetention";
import { createThreadMetadata, cloneThread } from "./threadHelpers";
import type { ChatStoreState } from "./types";
import {
  ensureActiveSession,
  findSessionIndexEntry,
  isDraftSessionEntry,
  patchSessionIndexEntry,
  promoteDraftSessionIndexEntry,
  resolveTargetSessionId,
} from "./sessions";
import { patchWorkspaceState, resolveChatScopeKey, threadForSession } from "./workspace";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createThreadMessagesSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
}) {
  const { update, getSnapshot } = deps;

  return {
    appendMessage(
      message: ChatMessage,
      options?: { sessionId?: string; skipCompaction?: boolean },
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

        let sessionId = resolveTargetSessionId(state, options?.sessionId);
        let workingState = state;
        let workspace = state.workspaces[root];

        if (!sessionId) {
          if (message.role !== "user") {
            return state;
          }
          const ensured = ensureActiveSession(state);
          if (!ensured) {
            return state;
          }
          workingState = ensured.state;
          workspace = ensured.workspace;
          sessionId = ensured.sessionId;
        }

        if (!workspace || !sessionId) {
          return state;
        }

        const existingThread = workspace.threadsBySessionId[sessionId] ?? null;
        if (!existingThread && message.role !== "user") {
          return state;
        }

        const thread = cloneThread(existingThread) ?? {
          metadata: createThreadMetadata(sessionId, message.createdAt, root),
          messages: [],
        };
        thread.messages = [...thread.messages, { ...message }];
        thread.metadata = {
          ...thread.metadata,
          updatedAt: message.createdAt,
        };
        const nextThread = options?.skipCompaction ? thread : compactChatThread(thread).thread;

        let nextSessionIndex = workspace.sessionIndex;
        if (message.role === "user") {
          const userMessageCount = nextThread.messages.filter((entry) => entry.role === "user").length;
          const indexEntry = findSessionIndexEntry(workspace, sessionId);
          if (userMessageCount === 1 && isDraftSessionEntry(indexEntry)) {
            nextSessionIndex = patchSessionIndexEntry(
              workspace.sessionIndex,
              sessionId,
              promoteDraftSessionIndexEntry(indexEntry!, message.content, message.createdAt),
            );
          } else if (indexEntry) {
            nextSessionIndex = patchSessionIndexEntry(workspace.sessionIndex, sessionId, {
              ...indexEntry,
              lastUsedAt: message.createdAt,
            });
          }
        }

        appended = true;
        return patchWorkspaceState(workingState, root, {
          ...workspace,
          activeSessionId: workspace.activeSessionId ?? sessionId,
          sessionIndex: nextSessionIndex,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [sessionId]: nextThread,
          },
        });
      });
      return appended;
    },
    updateMessageContent(
      messageId: string,
      content: string,
      sessionId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      let updated = false;
      update((state) => {
        const root = resolveChatScopeKey(state, workspaceRoot);
        const targetSessionId = resolveTargetSessionId(state, sessionId);
        if (!root || !targetSessionId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsBySessionId[targetSessionId];
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
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: nextThread,
          },
        });
      });
      return updated;
    },
    removeMessage(messageId: string, sessionId?: string, workspaceRoot?: string | null): boolean {
      let removed = false;
      update((state) => {
        const root = resolveChatScopeKey(state, workspaceRoot);
        const targetSessionId = resolveTargetSessionId(state, sessionId);
        if (!root || !targetSessionId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsBySessionId[targetSessionId];
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
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: nextThread,
          },
        });
      });
      return removed;
    },
    compactActiveThread(sessionId?: string): boolean {
      let compacted = false;
      update((state) => {
        const root = state.activeChatScopeKey;
        const targetSessionId = resolveTargetSessionId(state, sessionId);
        if (!root || !targetSessionId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsBySessionId[targetSessionId];
        if (!thread) {
          return state;
        }
        const result = compactChatThread(thread);
        compacted = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: result.thread,
          },
        });
      });
      return compacted;
    },
    updateMessageToolCalls(
      messageId: string,
      toolCalls: ToolCallRecord[],
      sessionId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      let updated = false;
      update((state) => {
        const root = resolveChatScopeKey(state, workspaceRoot);
        const targetSessionId = resolveTargetSessionId(state, sessionId);
        if (!root || !targetSessionId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsBySessionId[targetSessionId];
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
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: nextThread,
          },
        });
      });
      return updated;
    },
    updateMessageParts(
      messageId: string,
      parts: ChatMessagePart[],
      sessionId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      let updated = false;
      update((state) => {
        const root = resolveChatScopeKey(state, workspaceRoot);
        const targetSessionId = resolveTargetSessionId(state, sessionId);
        if (!root || !targetSessionId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsBySessionId[targetSessionId];
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
          index === messageIndex ? { ...entry, parts } : entry,
        );
        nextThread.metadata = {
          ...nextThread.metadata,
          updatedAt,
        };
        updated = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: nextThread,
          },
        });
      });
      return updated;
    },
    getMessages(sessionId?: string): ChatMessage[] {
      const targetSessionId = resolveTargetSessionId(getSnapshot(), sessionId);
      const thread = threadForSession(getSnapshot(), targetSessionId);
      return thread?.messages ?? [];
    },
    /**
     * Replaces all messages for a session's thread with the supplied list.
     * Used by workspace-session hydration (M1-T3): the OpenCode `session.messages`
     * payload becomes the display source of truth; the local snapshot is an
     * offline cache/fallback. Returns false if no thread exists for the session.
     */
    setThreadMessages(
      messages: ChatMessage[],
      sessionId?: string,
      workspaceRoot?: string | null,
    ): boolean {
      let updated = false;
      update((state) => {
        const root = resolveChatScopeKey(state, workspaceRoot);
        const targetSessionId = resolveTargetSessionId(state, sessionId);
        if (!root || !targetSessionId) {
          return state;
        }
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const existingThread = workspace.threadsBySessionId[targetSessionId];
        if (!existingThread) {
          return state;
        }

        const nextThread = cloneThread(existingThread);
        if (!nextThread) {
          return state;
        }
        nextThread.messages = messages.map((message) => ({ ...message }));
        const lastMessage = nextThread.messages[nextThread.messages.length - 1];
        nextThread.metadata = {
          ...nextThread.metadata,
          updatedAt: lastMessage?.createdAt ?? new Date().toISOString(),
        };
        updated = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: nextThread,
          },
        });
      });
      return updated;
    },
  };
}
