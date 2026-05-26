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
import {
  clearWorkspaceChatFileSnapshot,
  readWorkspaceChatFileSnapshot,
} from "../services/chatPersistence";
import { compactChatThread } from "../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";

interface ChatStoreState {
  activeWorkspaceRoot: string | null;
  threadsByWorkspace: Record<string, ChatThreadSnapshot | null>;
  accessByWorkspace: Record<string, ChatAccessState>;
  runtimeByWorkspace: Record<string, ChatThreadRuntimeState>;
}

export interface ChatTurnError {
  message: string;
  code?: string;
}

/** Ephemeral per-workspace chat runtime; not persisted to disk. */
export interface ChatThreadRuntimeState {
  isGenerating: boolean;
  lastFailedTurnId: string | null;
  lastError: ChatTurnError | null;
  activeTurnId: string | null;
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

const WORKSPACE_ACCESS_LOSS_MESSAGE =
  "Workspace file access was lost. AI cannot read files until access is restored.";

const initialState: ChatStoreState = {
  activeWorkspaceRoot: null,
  threadsByWorkspace: {},
  accessByWorkspace: {},
  runtimeByWorkspace: {},
};

function defaultRuntimeState(): ChatThreadRuntimeState {
  return {
    isGenerating: false,
    lastFailedTurnId: null,
    lastError: null,
    activeTurnId: null,
  };
}

function activeRuntime(state: ChatStoreState): ChatThreadRuntimeState {
  if (!state.activeWorkspaceRoot) {
    return defaultRuntimeState();
  }
  return state.runtimeByWorkspace[state.activeWorkspaceRoot] ?? defaultRuntimeState();
}

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

  function appendWorkspaceAccessLossMessage(rootPath: string): void {
    const checkedAt = new Date().toISOString();
    update((state) => {
      const thread = state.threadsByWorkspace[rootPath];
      if (!thread || thread.messages.length === 0) {
        return state;
      }
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (
        lastMessage.role === "system" &&
        lastMessage.content === WORKSPACE_ACCESS_LOSS_MESSAGE
      ) {
        return state;
      }
      const nextThread = cloneThread(thread);
      if (!nextThread) {
        return state;
      }
      nextThread.messages = [
        ...nextThread.messages,
        {
          id: `access-loss-${checkedAt}`,
          role: "system",
          content: WORKSPACE_ACCESS_LOSS_MESSAGE,
          createdAt: checkedAt,
        },
      ];
      nextThread.metadata = {
        ...nextThread.metadata,
        updatedAt: checkedAt,
      };
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [rootPath]: nextThread,
        },
      };
    });
  }

  function commitAccessPreflightResult(
    rootPath: string,
    nextState: ChatAccessState,
    previousState: ChatAccessState | undefined,
  ): ChatAccessState {
    if (
      previousState?.status === "ready" &&
      nextState.status === "blocked" &&
      nextState.reason === WorkspaceAccessReason.WorkspacePathInaccessible
    ) {
      appendWorkspaceAccessLossMessage(rootPath);
    }
    setWorkspaceAccessState(rootPath, nextState);
    return nextState;
  }

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityChecker ?? stubCapabilityChecker;
  }

  function updateActiveRuntime(
    updater: (runtime: ChatThreadRuntimeState) => ChatThreadRuntimeState,
  ): boolean {
    let updated = false;
    update((state) => {
      const root = state.activeWorkspaceRoot;
      if (!root) {
        return state;
      }
      const current = state.runtimeByWorkspace[root] ?? defaultRuntimeState();
      updated = true;
      return {
        ...state,
        runtimeByWorkspace: {
          ...state.runtimeByWorkspace,
          [root]: updater(current),
        },
      };
    });
    return updated;
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

        const access = state.accessByWorkspace[root];
        if (access?.status === "blocked" && message.role === "user") {
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
        const compacted = compactChatThread(thread);
        const nextThread = compacted.thread;

        appended = true;
        return {
          ...state,
          threadsByWorkspace: {
            ...state.threadsByWorkspace,
            [root]: nextThread,
          },
        };
      });
      return appended;
    },
    async clearActiveWorkspaceChatHistory(): Promise<boolean> {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return false;
      }

      update((state) => ({
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [root]: null,
        },
        runtimeByWorkspace: {
          ...state.runtimeByWorkspace,
          [root]: defaultRuntimeState(),
        },
      }));
      await clearWorkspaceChatFileSnapshot(root);
      return true;
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
          updatedMetadata = true;
          return {
            ...state,
            threadsByWorkspace: {
              ...state.threadsByWorkspace,
              [root]: {
                metadata: applyMetadataPatch(createThreadMetadata(updatedAt), patch, updatedAt),
                messages: [],
              },
            },
          };
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
    getRuntimeState(): ChatThreadRuntimeState {
      return { ...activeRuntime(this.getSnapshot()) };
    },
    beginTurn(turnId: string): boolean {
      if (!this.getActiveWorkspaceRoot()) {
        return false;
      }
      const runtime = this.getRuntimeState();
      if (runtime.isGenerating) {
        return false;
      }
      return updateActiveRuntime(() => ({
        isGenerating: true,
        activeTurnId: turnId,
        lastFailedTurnId: null,
        lastError: null,
      }));
    },
    completeTurn(): boolean {
      if (!this.getActiveWorkspaceRoot()) {
        return false;
      }
      const runtime = this.getRuntimeState();
      if (!runtime.isGenerating) {
        return false;
      }
      return updateActiveRuntime(() => defaultRuntimeState());
    },
    failTurn(error: ChatTurnError, turnId?: string): boolean {
      if (!this.getActiveWorkspaceRoot()) {
        return false;
      }
      const runtime = this.getRuntimeState();
      const failedTurnId = turnId ?? runtime.activeTurnId;
      if (!failedTurnId) {
        return false;
      }
      return updateActiveRuntime(() => ({
        isGenerating: false,
        activeTurnId: null,
        lastFailedTurnId: failedTurnId,
        lastError: { ...error },
      }));
    },
    canRetryLastTurn(): boolean {
      const runtime = this.getRuntimeState();
      return runtime.lastFailedTurnId !== null && !runtime.isGenerating;
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
      const snapshot = this.getSnapshot();
      const rootPath = snapshot.activeWorkspaceRoot;
      if (!rootPath) {
        return defaultUnknownAccessState("Open a workspace to use AI chat.");
      }

      const previousState = snapshot.accessByWorkspace[rootPath];

      const workspaceAccess = await ensureWorkspaceReadAccess(rootPath);
      if (workspaceAccess !== "ready") {
        const blockedState: ChatAccessState = {
          status: "blocked",
          reason: WorkspaceAccessReason.WorkspacePathInaccessible,
          message: "AI cannot read files in this workspace because the path is inaccessible.",
          recoveryHint: "Re-open the workspace path and confirm file permissions.",
          checkedAt: new Date().toISOString(),
        };
        return commitAccessPreflightResult(rootPath, blockedState, previousState);
      }

      const capabilityResult = await this.checkActiveWorkspaceCapabilities();
      const nextState: ChatAccessState = {
        status: capabilityResult.status,
        reason: capabilityResult.reason,
        message: capabilityResult.message,
        recoveryHint: capabilityResult.recoveryHint,
        checkedAt: new Date().toISOString(),
      };
      return commitAccessPreflightResult(rootPath, nextState, previousState);
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
export const chatRuntimeState = derived(chatStore, ($chatStore) => activeRuntime($chatStore));
export const chatIsGenerating = derived(chatRuntimeState, ($runtime) => $runtime.isGenerating);
export const chatCanRetryLastTurn = derived(chatRuntimeState, ($runtime) =>
  Boolean($runtime.lastFailedTurnId && !$runtime.isGenerating),
);

export function formatCompactionNotice(compactedMessageCount: number): string {
  const label = compactedMessageCount === 1 ? "message" : "messages";
  return `${compactedMessageCount} older ${label} compacted`;
}
