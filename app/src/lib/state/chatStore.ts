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
  type WorkspaceAccessStatus,
  type CapabilityCheckResult,
  type CapabilityChecker,
} from "../ai/capabilities";
import { readWorkspaceChatFileSnapshot } from "../services/chatPersistence";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

interface ChatStoreState {
  activeWorkspaceRoot: string | null;
  threadsByWorkspace: Record<string, ChatThreadSnapshot | null>;
  accessByWorkspace: Record<string, ChatAccessState>;
}

export interface ChatAccessState {
  status: WorkspaceAccessStatus;
  reason: WorkspaceAccessReason;
  message: string;
  recoveryHint?: string;
  checkedAt: string;
}

const DEFAULT_CHAT_MODE: ChatModeId = "ask";
const DEFAULT_CHAT_PROVIDER: ChatProviderId = "glm";

const initialState: ChatStoreState = {
  activeWorkspaceRoot: null,
  threadsByWorkspace: {},
  accessByWorkspace: {},
};

function defaultUnknownAccessState(message: string): ChatAccessState {
  return {
    status: "unknown",
    reason: WorkspaceAccessReason.Unknown,
    message,
    checkedAt: new Date().toISOString(),
  };
}

const stubCapabilityChecker: CapabilityChecker = {
  async checkCapabilities() {
    return {
      status: "blocked",
      reason: WorkspaceAccessReason.ProviderUnsupported,
      capabilities: {
        canReadWorkspaceFiles: false,
        supportedModes: [],
      },
      message: "Provider capability checks are not integrated yet for this milestone.",
      recoveryHint: "Provider integration arrives in a later milestone.",
    };
  },
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

  function setWorkspaceAccessState(rootPath: string, next: ChatAccessState): void {
    update((state) => ({
      ...state,
      accessByWorkspace: {
        ...state.accessByWorkspace,
        [rootPath]: next,
      },
    }));
  }

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityChecker ?? stubCapabilityChecker;
  }

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

      if (!rootPath) {
        return {
          status: "unknown",
          reason: WorkspaceAccessReason.Unknown,
          capabilities: null,
          message: "Chat capability checks require an active workspace.",
        };
      }

      const checker = resolveCapabilityChecker();
      return checker.checkCapabilities({
        provider: metadata?.provider ?? DEFAULT_CHAT_PROVIDER,
        mode: metadata?.mode ?? DEFAULT_CHAT_MODE,
        workspaceRootPath: rootPath,
      });
    },
    getChatAccessState(): ChatAccessState {
      const snapshot = this.getSnapshot();
      const rootPath = snapshot.activeWorkspaceRoot;
      if (!rootPath) {
        return defaultUnknownAccessState("Open a workspace to use AI chat.");
      }
      return (
        snapshot.accessByWorkspace[rootPath] ??
        defaultUnknownAccessState("Chat access preflight has not run yet.")
      );
    },
    async runAccessPreflight(): Promise<ChatAccessState> {
      const rootPath = this.getActiveWorkspaceRoot();
      if (!rootPath) {
        return defaultUnknownAccessState("Open a workspace to use AI chat.");
      }

      const workspaceAccess = await ensureWorkspaceReadAccess(rootPath);
      if (workspaceAccess !== "ready") {
        const blockedState: ChatAccessState = {
          status: "blocked",
          reason: WorkspaceAccessReason.WorkspacePathInaccessible,
          message: "AI cannot read files in this workspace because the path is inaccessible.",
          recoveryHint: "Re-open the workspace path and confirm file permissions.",
          checkedAt: new Date().toISOString(),
        };
        setWorkspaceAccessState(rootPath, blockedState);
        return blockedState;
      }

      const capabilityResult = await this.checkActiveWorkspaceCapabilities();
      const nextState: ChatAccessState = {
        status: capabilityResult.status,
        reason: capabilityResult.reason,
        message: capabilityResult.message,
        recoveryHint: capabilityResult.recoveryHint,
        checkedAt: new Date().toISOString(),
      };
      setWorkspaceAccessState(rootPath, nextState);
      return nextState;
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
export const chatAccessState = derived(chatStore, ($chatStore) => {
  const rootPath = $chatStore.activeWorkspaceRoot;
  if (!rootPath) {
    return defaultUnknownAccessState("Open a workspace to use AI chat.");
  }
  return (
    $chatStore.accessByWorkspace[rootPath] ??
    defaultUnknownAccessState("Chat access preflight has not run yet.")
  );
});
