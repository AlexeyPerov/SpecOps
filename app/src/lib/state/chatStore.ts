import { derived, writable } from "svelte/store";
import type {
  ChatMessage,
  ChatModeId,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
} from "../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckResult,
  type CapabilityChecker,
} from "../ai/capabilities";
import { readWorkspaceChatFileSnapshot } from "../services/chatPersistence";

interface ChatStoreState {
  activeWorkspaceRoot: string | null;
  threadsByWorkspace: Record<string, ChatThreadSnapshot | null>;
}

const DEFAULT_CHAT_MODE: ChatModeId = "ask";
const DEFAULT_CHAT_PROVIDER: ChatProviderId = "glm";

const initialState: ChatStoreState = {
  activeWorkspaceRoot: null,
  threadsByWorkspace: {},
};

function cloneThread(thread: ChatThreadSnapshot | null): ChatThreadSnapshot | null {
  if (!thread) {
    return null;
  }
  return {
    metadata: { ...thread.metadata },
    messages: thread.messages.map((message) => ({
      ...message,
      systemEvent: message.systemEvent ? { ...message.systemEvent } : undefined,
    })),
  };
}

function activeThread(state: ChatStoreState): ChatThreadSnapshot | null {
  if (!state.activeWorkspaceRoot) {
    return null;
  }
  return state.threadsByWorkspace[state.activeWorkspaceRoot] ?? null;
}

function createThreadMetadata(createdAt: string): ChatThreadMetadata {
  return {
    mode: DEFAULT_CHAT_MODE,
    provider: DEFAULT_CHAT_PROVIDER,
    createdAt,
    updatedAt: createdAt,
  };
}

function applyMetadataPatch(
  metadata: ChatThreadMetadata,
  patch: Partial<Pick<ChatThreadMetadata, "mode" | "provider" | "summary">>,
  updatedAt: string,
): ChatThreadMetadata {
  return {
    ...metadata,
    ...patch,
    updatedAt,
  };
}

function createChatStore() {
  const { subscribe, set, update } = writable<ChatStoreState>(initialState);
  let capabilityChecker: CapabilityChecker | null = null;

  return {
    subscribe,
    reset() {
      set(initialState);
    },
    getSnapshot(): ChatStoreState {
      let snapshot = initialState;
      const un = subscribe((state) => {
        snapshot = state;
      });
      un();
      return snapshot;
    },
    setActiveWorkspaceRoot(normalizedRootPath: string | null): void {
      update((state) => {
        if (state.activeWorkspaceRoot === normalizedRootPath) {
          return state;
        }
        return {
          ...state,
          activeWorkspaceRoot: normalizedRootPath,
        };
      });
    },
    setWorkspaceThread(normalizedRootPath: string, thread: ChatThreadSnapshot | null): void {
      update((state) => ({
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [normalizedRootPath]: cloneThread(thread),
        },
      }));
    },
    async loadWorkspaceThread(normalizedRootPath: string): Promise<void> {
      const snapshot = await readWorkspaceChatFileSnapshot(normalizedRootPath);
      update((state) => ({
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [normalizedRootPath]: cloneThread(snapshot.thread),
        },
      }));
    },
    appendMessage(message: ChatMessage): boolean {
      let appended = false;
      update((state) => {
        const root = state.activeWorkspaceRoot;
        if (!root) {
          return state;
        }

        const existingThread = state.threadsByWorkspace[root] ?? null;
        if (!existingThread && message.role !== "user") {
          return state;
        }

        const thread = cloneThread(existingThread) ?? {
          metadata: createThreadMetadata(message.createdAt),
          messages: [],
        };
        thread.messages = [...thread.messages, { ...message }];
        thread.metadata = {
          ...thread.metadata,
          updatedAt: message.createdAt,
        };

        appended = true;
        return {
          ...state,
          threadsByWorkspace: {
            ...state.threadsByWorkspace,
            [root]: thread,
          },
        };
      });
      return appended;
    },
    updateThreadMetadata(
      patch: Partial<Pick<ChatThreadMetadata, "mode" | "provider" | "summary">>,
      updatedAt: string = new Date().toISOString(),
    ): boolean {
      let updatedMetadata = false;
      update((state) => {
        const root = state.activeWorkspaceRoot;
        if (!root) {
          return state;
        }
        const thread = state.threadsByWorkspace[root];
        if (!thread) {
          return state;
        }

        updatedMetadata = true;
        return {
          ...state,
          threadsByWorkspace: {
            ...state.threadsByWorkspace,
            [root]: {
              ...thread,
              metadata: applyMetadataPatch(thread.metadata, patch, updatedAt),
            },
          },
        };
      });
      return updatedMetadata;
    },
    getMessages(): ChatMessage[] {
      const thread = activeThread(this.getSnapshot());
      return thread?.messages ?? [];
    },
    getActiveWorkspaceRoot(): string | null {
      return this.getSnapshot().activeWorkspaceRoot;
    },
    getActiveThreadSnapshot(): ChatThreadSnapshot | null {
      return cloneThread(activeThread(this.getSnapshot()));
    },
    getMetadata(): ChatThreadMetadata | null {
      const thread = activeThread(this.getSnapshot());
      return thread?.metadata ?? null;
    },
    hasThread(): boolean {
      return this.getMetadata() !== null;
    },
    isEmpty(): boolean {
      return this.getMessages().length === 0;
    },
    setCapabilityChecker(checker: CapabilityChecker | null): void {
      capabilityChecker = checker;
    },
    async checkActiveWorkspaceCapabilities(): Promise<CapabilityCheckResult> {
      const rootPath = this.getActiveWorkspaceRoot();
      const metadata = this.getMetadata();

      if (!rootPath || !metadata || !capabilityChecker) {
        return {
          status: "unknown",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: null,
          message: "Capability checker is not configured yet.",
        };
      }

      return capabilityChecker.checkCapabilities({
        provider: metadata.provider,
        mode: metadata.mode,
        workspaceRootPath: rootPath,
      });
    },
  };
}

export const chatStore = createChatStore();

export const chatMessages = derived(chatStore, ($chatStore) => activeThread($chatStore)?.messages ?? []);
export const chatMetadata = derived(chatStore, ($chatStore) => activeThread($chatStore)?.metadata ?? null);
export const chatHasThread = derived(chatStore, ($chatStore) => activeThread($chatStore) !== null);
export const chatIsEmpty = derived(
  chatStore,
  ($chatStore) => (activeThread($chatStore)?.messages.length ?? 0) === 0,
);
