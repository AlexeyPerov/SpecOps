import { derived, writable } from "svelte/store";
import type {
  AgentIndexEntry,
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
  DEBUG_PROVIDER_SWITCH_BLOCKED_MESSAGE,
  WORKSPACE_ACCESS_LOST_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
} from "../ai/chatErrorCopy";
import {
  deleteAgentPersistence,
  readAgentThreadFileSnapshot,
  readWorkspaceAgentsIndexSnapshot,
} from "../services/chatPersistence";
import { DRAFT_AGENT_TITLE, deriveAgentTitle } from "../services/chatAgents";
import { compactChatThread } from "../services/chatRetention";
import { ensureWorkspaceReadAccess } from "../services/fileSystem";
import { formatProviderSwitchNotice } from "../ai/providers/selection";

export interface WorkspaceAgentsState {
  activeAgentId: string | null;
  agentIndex: AgentIndexEntry[];
  threadsByAgentId: Record<string, ChatThreadSnapshot | null>;
  runtimeByAgentId: Record<string, ChatThreadRuntimeState>;
}

interface ChatStoreState {
  activeWorkspaceRoot: string | null;
  workspaces: Record<string, WorkspaceAgentsState>;
  accessByWorkspace: Record<string, ChatAccessState>;
}

export interface ChatTurnError {
  message: string;
  code?: string;
}

/** Ephemeral per-agent chat runtime; not persisted to disk. */
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

export interface SwitchThreadProviderResult {
  switched: boolean;
  message?: string;
}

const DEFAULT_CHAT_MODE: ChatModeId = "ask";
const DEFAULT_CHAT_PROVIDER: ChatProviderId = "glm";

let defaultChatProviderResolver: () => ChatProviderId = () => DEFAULT_CHAT_PROVIDER;
let agentIdCounter = 0;

const WORKSPACE_ACCESS_LOSS_MESSAGE = WORKSPACE_ACCESS_LOST_MESSAGE;

const initialWorkspaceAgentsState = (): WorkspaceAgentsState => ({
  activeAgentId: null,
  agentIndex: [],
  threadsByAgentId: {},
  runtimeByAgentId: {},
});

const initialState: ChatStoreState = {
  activeWorkspaceRoot: null,
  workspaces: {},
  accessByWorkspace: {},
};

/** Clears agent id counter between unit tests. */
export function resetAgentIdCounterForTests(): void {
  agentIdCounter = 0;
}

export function createAgentId(): string {
  agentIdCounter += 1;
  return `agent-${agentIdCounter}`;
}

function defaultRuntimeState(): ChatThreadRuntimeState {
  return {
    isGenerating: false,
    lastFailedTurnId: null,
    lastError: null,
    activeTurnId: null,
  };
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

function workspaceState(state: ChatStoreState, root: string | null): WorkspaceAgentsState | null {
  if (!root) {
    return null;
  }
  return state.workspaces[root] ?? null;
}

function getOrCreateWorkspaceState(
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

function patchWorkspaceState(
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

function activeAgentId(state: ChatStoreState): string | null {
  return workspaceState(state, state.activeWorkspaceRoot)?.activeAgentId ?? null;
}

function threadForAgent(
  state: ChatStoreState,
  agentId: string | null,
): ChatThreadSnapshot | null {
  const root = state.activeWorkspaceRoot;
  if (!root || !agentId) {
    return null;
  }
  return state.workspaces[root]?.threadsByAgentId[agentId] ?? null;
}

function activeThread(state: ChatStoreState): ChatThreadSnapshot | null {
  return threadForAgent(state, activeAgentId(state));
}

function resolveWorkspaceRoot(state: ChatStoreState, workspaceRoot?: string | null): string | null {
  return workspaceRoot ?? state.activeWorkspaceRoot;
}

function runtimeForAgentInWorkspace(
  state: ChatStoreState,
  workspaceRoot: string | null,
  agentId: string | null,
): ChatThreadRuntimeState {
  if (!workspaceRoot || !agentId) {
    return defaultRuntimeState();
  }
  return state.workspaces[workspaceRoot]?.runtimeByAgentId[agentId] ?? defaultRuntimeState();
}

function runtimeForAgent(state: ChatStoreState, agentId: string | null): ChatThreadRuntimeState {
  return runtimeForAgentInWorkspace(state, state.activeWorkspaceRoot, agentId);
}

function assistantPlaceholderId(turnId: string): string {
  return `assistant-${turnId}`;
}

function activeRuntime(state: ChatStoreState): ChatThreadRuntimeState {
  return runtimeForAgent(state, activeAgentId(state));
}

function createThreadMetadata(agentId: string, createdAt: string): ChatThreadMetadata {
  return {
    agentId,
    threadId: agentId,
    mode: DEFAULT_CHAT_MODE,
    provider: defaultChatProviderResolver(),
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

function createDraftAgentEntry(agentId: string, lastUsedAt: string): AgentIndexEntry {
  return {
    id: agentId,
    title: DRAFT_AGENT_TITLE,
    lastUsedAt,
    isDraft: true,
  };
}

function findAgentIndexEntry(
  workspace: WorkspaceAgentsState,
  agentId: string,
): AgentIndexEntry | undefined {
  return workspace.agentIndex.find((entry) => entry.id === agentId);
}

function isDraftAgentEntry(entry: AgentIndexEntry | undefined): boolean {
  return entry?.isDraft === true;
}

function promoteDraftAgentIndexEntry(
  entry: AgentIndexEntry,
  firstUserMessageContent: string,
  lastUsedAt: string,
): AgentIndexEntry {
  return {
    id: entry.id,
    title: deriveAgentTitle({ firstUserMessage: firstUserMessageContent }),
    lastUsedAt,
  };
}

function patchAgentIndexEntry(
  agentIndex: AgentIndexEntry[],
  agentId: string,
  nextEntry: AgentIndexEntry,
): AgentIndexEntry[] {
  return agentIndex.map((entry) => (entry.id === agentId ? nextEntry : entry));
}

function ensureActiveAgent(
  state: ChatStoreState,
): { state: ChatStoreState; workspace: WorkspaceAgentsState; agentId: string } | null {
  const root = state.activeWorkspaceRoot;
  if (!root) {
    return null;
  }

  const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
  if (workspace.activeAgentId) {
    return { state: nextState, workspace, agentId: workspace.activeAgentId };
  }

  const agentId = createAgentId();
  const lastUsedAt = new Date().toISOString();
  const nextWorkspace: WorkspaceAgentsState = {
    ...workspace,
    activeAgentId: agentId,
    agentIndex: [...workspace.agentIndex, createDraftAgentEntry(agentId, lastUsedAt)],
  };

  return {
    state: patchWorkspaceState(nextState, root, nextWorkspace),
    workspace: nextWorkspace,
    agentId,
  };
}

function resolveTargetAgentId(state: ChatStoreState, agentId?: string): string | null {
  if (agentId) {
    return agentId;
  }
  return activeAgentId(state);
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

  function appendAgentAccessLossMessage(rootPath: string, agentId: string): void {
    const checkedAt = new Date().toISOString();
    update((state) => {
      const workspace = state.workspaces[rootPath];
      if (!workspace) {
        return state;
      }
      const thread = workspace.threadsByAgentId[agentId];
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
      return patchWorkspaceState(state, rootPath, {
        ...workspace,
        threadsByAgentId: {
          ...workspace.threadsByAgentId,
          [agentId]: nextThread,
        },
      });
    });
  }

  function commitAccessPreflightResult(
    rootPath: string,
    nextState: ChatAccessState,
    previousState: ChatAccessState | undefined,
    snapshot: ChatStoreState,
  ): ChatAccessState {
    if (
      previousState?.status === "ready" &&
      nextState.status === "blocked" &&
      nextState.reason === WorkspaceAccessReason.WorkspacePathInaccessible
    ) {
      const workspace = snapshot.workspaces[rootPath];
      const agentsWithThreads = workspace
        ? Object.keys(workspace.threadsByAgentId).filter(
            (agentId) => (workspace.threadsByAgentId[agentId]?.messages.length ?? 0) > 0,
          )
        : [];
      for (const agentId of agentsWithThreads) {
        appendAgentAccessLossMessage(rootPath, agentId);
      }
    }
    setWorkspaceAccessState(rootPath, nextState);
    return nextState;
  }

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityChecker ?? stubCapabilityChecker;
  }

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
    subscribe,
    reset() {
      set(initialState);
      resetAgentIdCounterForTests();
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
    setActiveAgentId(agentId: string | null): void {
      update((state) => {
        const root = state.activeWorkspaceRoot;
        if (!root) {
          return state;
        }
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        if (workspace.activeAgentId === agentId) {
          return nextState;
        }
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          activeAgentId: agentId,
        });
      });
    },
    getActiveAgentId(): string | null {
      return activeAgentId(this.getSnapshot());
    },
    createDraftAgent(options?: { activate?: boolean }): string | null {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return null;
      }

      let createdAgentId: string | null = null;
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        const agentId = createAgentId();
        const lastUsedAt = new Date().toISOString();
        const activate = options?.activate !== false;
        createdAgentId = agentId;
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          activeAgentId: activate ? agentId : workspace.activeAgentId,
          agentIndex: [...workspace.agentIndex, createDraftAgentEntry(agentId, lastUsedAt)],
        });
      });
      return createdAgentId;
    },
    isAgentDraft(agentId: string): boolean {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return false;
      }
      const workspace = this.getSnapshot().workspaces[root];
      if (!workspace) {
        return false;
      }
      return isDraftAgentEntry(findAgentIndexEntry(workspace, agentId));
    },
    getAgentTitle(agentId: string): string | null {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return null;
      }
      const workspace = this.getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      return findAgentIndexEntry(workspace, agentId)?.title ?? null;
    },
    getAgentIndex(): AgentIndexEntry[] {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return [];
      }
      return [...(this.getSnapshot().workspaces[root]?.agentIndex ?? [])];
    },
    getWorkspaceAgentsState(root: string): WorkspaceAgentsState | null {
      const workspace = this.getSnapshot().workspaces[root];
      if (!workspace) {
        return null;
      }
      return {
        activeAgentId: workspace.activeAgentId,
        agentIndex: [...workspace.agentIndex],
        threadsByAgentId: { ...workspace.threadsByAgentId },
        runtimeByAgentId: { ...workspace.runtimeByAgentId },
      };
    },
    setAgentThread(agentId: string, thread: ChatThreadSnapshot | null): void {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return;
      }
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, root);
        return patchWorkspaceState(nextState, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [agentId]: cloneThread(thread),
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
                title: thread ? DRAFT_AGENT_TITLE : DRAFT_AGENT_TITLE,
                lastUsedAt: thread?.metadata.updatedAt ?? new Date().toISOString(),
                isDraft: !thread || thread.messages.length === 0,
              },
            ];
        return {
          ...state,
          activeWorkspaceRoot: normalizedRootPath,
          workspaces: {
            ...nextState.workspaces,
            [normalizedRootPath]: {
              ...workspace,
              activeAgentId: agentId,
              agentIndex: nextIndex,
              threadsByAgentId: {
                ...workspace.threadsByAgentId,
                [agentId]: cloneThread(thread),
              },
            },
          },
        };
      });
    },
    async loadWorkspaceAgents(normalizedRootPath: string): Promise<void> {
      const index = await readWorkspaceAgentsIndexSnapshot(normalizedRootPath);
      const threadsByAgentId: Record<string, ChatThreadSnapshot | null> = {};
      for (const entry of index.agents) {
        if (entry.isDraft) {
          continue;
        }
        const thread = await readAgentThreadFileSnapshot(normalizedRootPath, entry.id);
        threadsByAgentId[entry.id] = cloneThread(thread);
      }

      update((state) => {
        const existing = state.workspaces[normalizedRootPath];
        const activeAgentIdValue =
          existing?.activeAgentId && index.agents.some((entry) => entry.id === existing.activeAgentId)
            ? existing.activeAgentId
            : null;

        return {
          ...state,
          workspaces: {
            ...state.workspaces,
            [normalizedRootPath]: {
              activeAgentId: activeAgentIdValue,
              agentIndex: index.agents,
              threadsByAgentId,
              runtimeByAgentId: existing?.runtimeByAgentId ?? {},
            },
          },
        };
      });
    },
    mergeSessionDraftAgents(normalizedRootPath: string, agentIds: readonly string[]): void {
      if (agentIds.length === 0) {
        return;
      }
      update((state) => {
        const { nextState, workspace } = getOrCreateWorkspaceState(state, normalizedRootPath);
        const knownIds = new Set(workspace.agentIndex.map((entry) => entry.id));
        const additions: AgentIndexEntry[] = [];
        const lastUsedAt = new Date().toISOString();
        for (const agentId of agentIds) {
          if (knownIds.has(agentId)) {
            continue;
          }
          knownIds.add(agentId);
          additions.push(createDraftAgentEntry(agentId, lastUsedAt));
        }
        if (additions.length === 0) {
          return nextState;
        }
        return patchWorkspaceState(nextState, normalizedRootPath, {
          ...workspace,
          agentIndex: [...workspace.agentIndex, ...additions],
        });
      });
    },
    /** @deprecated Use loadWorkspaceAgents. */
    async loadWorkspaceThread(normalizedRootPath: string): Promise<void> {
      await this.loadWorkspaceAgents(normalizedRootPath);
    },
    appendMessage(
      message: ChatMessage,
      options?: { agentId?: string; skipCompaction?: boolean },
    ): boolean {
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
        const root = state.activeWorkspaceRoot;
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
    async deleteAgent(agentId: string): Promise<boolean> {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return false;
      }

      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }

        const { [agentId]: _removedThread, ...remainingThreads } = workspace.threadsByAgentId;
        const { [agentId]: _removedRuntime, ...remainingRuntime } = workspace.runtimeByAgentId;
        const nextActiveAgentId =
          workspace.activeAgentId === agentId ? null : workspace.activeAgentId;

        return patchWorkspaceState(state, root, {
          ...workspace,
          activeAgentId: nextActiveAgentId,
          agentIndex: workspace.agentIndex.filter((entry) => entry.id !== agentId),
          threadsByAgentId: remainingThreads,
          runtimeByAgentId: remainingRuntime,
        });
      });

      await deleteAgentPersistence(root, agentId);
      return true;
    },
    async clearActiveWorkspaceChatHistory(): Promise<boolean> {
      const agentId = this.getActiveAgentId();
      if (!agentId) {
        return false;
      }
      return this.deleteAgent(agentId);
    },
    updateThreadMetadata(
      patch: Partial<Pick<ChatThreadMetadata, "mode" | "provider" | "summary">>,
      updatedAt: string = new Date().toISOString(),
      agentId?: string,
    ): boolean {
      let updatedMetadata = false;
      update((state) => {
        const root = state.activeWorkspaceRoot;
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
                  createThreadMetadata(targetAgentId, updatedAt),
                  patch,
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
              metadata: applyMetadataPatch(thread.metadata, patch, updatedAt),
            },
          },
        });
      });
      return updatedMetadata;
    },
    getMessages(agentId?: string): ChatMessage[] {
      const targetAgentId = resolveTargetAgentId(this.getSnapshot(), agentId);
      const thread = threadForAgent(this.getSnapshot(), targetAgentId);
      return thread?.messages ?? [];
    },
    getActiveWorkspaceRoot(): string | null {
      return this.getSnapshot().activeWorkspaceRoot;
    },
    getActiveThreadSnapshot(agentId?: string): ChatThreadSnapshot | null {
      const targetAgentId = resolveTargetAgentId(this.getSnapshot(), agentId);
      return cloneThread(threadForAgent(this.getSnapshot(), targetAgentId));
    },
    getMetadata(agentId?: string): ChatThreadMetadata | null {
      const thread = threadForAgent(this.getSnapshot(), resolveTargetAgentId(this.getSnapshot(), agentId));
      return thread?.metadata ?? null;
    },
    getActiveChatProvider(agentId?: string): ChatProviderId {
      return this.getMetadata(agentId)?.provider ?? defaultChatProviderResolver();
    },
    hasThread(agentId?: string): boolean {
      return this.getMetadata(agentId) !== null;
    },
    isEmpty(agentId?: string): boolean {
      return this.getMessages(agentId).length === 0;
    },
    getRuntimeState(agentId?: string, workspaceRoot?: string | null): ChatThreadRuntimeState {
      const snapshot = this.getSnapshot();
      const root = resolveWorkspaceRoot(snapshot, workspaceRoot);
      const targetAgentId = agentId ?? (root ? snapshot.workspaces[root]?.activeAgentId ?? null : null);
      return { ...runtimeForAgentInWorkspace(snapshot, root, targetAgentId) };
    },
    isGenerationTurnActive(
      workspaceRoot: string,
      agentId: string,
      turnId: string,
    ): boolean {
      const runtime = runtimeForAgentInWorkspace(this.getSnapshot(), workspaceRoot, agentId);
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
      const workspace = this.getSnapshot().workspaces[workspaceRoot];
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
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return false;
      }
      const targetAgentId = resolveTargetAgentId(this.getSnapshot(), agentId);
      if (!targetAgentId) {
        return false;
      }
      const runtime = runtimeForAgent(this.getSnapshot(), targetAgentId);
      if (runtime.isGenerating) {
        return false;
      }
      return updateAgentRuntime(targetAgentId, () => ({
        isGenerating: true,
        activeTurnId: turnId,
        lastFailedTurnId: null,
        lastError: null,
      }));
    },
    completeTurn(agentId?: string, workspaceRoot?: string | null): boolean {
      const snapshot = this.getSnapshot();
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
      const snapshot = this.getSnapshot();
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
    setCapabilityChecker(checker: CapabilityChecker | null): void {
      capabilityChecker = checker;
    },
    setDefaultChatProviderResolver(resolver: () => ChatProviderId): void {
      defaultChatProviderResolver = resolver;
    },
    async switchThreadProvider(
      nextProvider: ChatProviderId,
      options: { debugProviderEnabled: boolean },
      agentId?: string,
    ): Promise<SwitchThreadProviderResult> {
      const root = this.getActiveWorkspaceRoot();
      if (!root) {
        return { switched: false, message: "Open a workspace to switch providers." };
      }

      const targetAgentId = resolveTargetAgentId(this.getSnapshot(), agentId);
      if (!targetAgentId) {
        return { switched: false, message: "Select an agent to switch providers." };
      }

      if (this.getRuntimeState(targetAgentId).isGenerating) {
        return {
          switched: false,
          message: "Provider cannot be changed while a response is generating.",
        };
      }

      if (nextProvider === "debug" && !options.debugProviderEnabled) {
        return {
          switched: false,
          message: DEBUG_PROVIDER_SWITCH_BLOCKED_MESSAGE,
        };
      }

      const metadata = this.getMetadata(targetAgentId);
      const fromProvider = metadata?.provider ?? null;
      if (fromProvider === nextProvider) {
        return { switched: false };
      }

      const capabilityResult = await resolveCapabilityChecker().checkCapabilities({
        provider: nextProvider,
        mode: metadata?.mode ?? DEFAULT_CHAT_MODE,
        workspaceRootPath: root,
      });

      let nextMode = metadata?.mode ?? DEFAULT_CHAT_MODE;
      const supportedModes = capabilityResult.capabilities?.supportedModes;
      if (supportedModes && supportedModes.length > 0 && !supportedModes.includes(nextMode)) {
        nextMode = supportedModes[0];
      }

      const updatedAt = new Date().toISOString();
      const systemEvent = {
        type: "provider-switched" as const,
        fromProvider,
        toProvider: nextProvider,
      };
      const switchMessage: ChatMessage = {
        id: `provider-switch-${updatedAt}`,
        role: "system",
        content: formatProviderSwitchNotice(systemEvent),
        createdAt: updatedAt,
        systemEvent,
      };

      let switched = false;
      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsByAgentId[targetAgentId];
        const baseThread =
          thread ??
          ({
            metadata: applyMetadataPatch(
              createThreadMetadata(targetAgentId, updatedAt),
              {},
              updatedAt,
            ),
            messages: [],
          } satisfies ChatThreadSnapshot);

        switched = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsByAgentId: {
            ...workspace.threadsByAgentId,
            [targetAgentId]: {
              ...baseThread,
              metadata: applyMetadataPatch(
                baseThread.metadata,
                { provider: nextProvider, mode: nextMode },
                updatedAt,
              ),
              messages: [...baseThread.messages, switchMessage],
            },
          },
          runtimeByAgentId: {
            ...workspace.runtimeByAgentId,
            [targetAgentId]: defaultRuntimeState(),
          },
        });
      });

      return { switched };
    },
    async checkActiveWorkspaceCapabilities(agentId?: string): Promise<CapabilityCheckResult> {
      const rootPath = this.getActiveWorkspaceRoot();
      const metadata = this.getMetadata(agentId);

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
        provider: metadata?.provider ?? defaultChatProviderResolver(),
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
          message: WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
          recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
          checkedAt: new Date().toISOString(),
        };
        return commitAccessPreflightResult(rootPath, blockedState, previousState, snapshot);
      }

      const capabilityResult = await this.checkActiveWorkspaceCapabilities();
      const nextState: ChatAccessState = {
        status: capabilityResult.status,
        reason: capabilityResult.reason,
        message: capabilityResult.message,
        recoveryHint: capabilityResult.recoveryHint,
        checkedAt: new Date().toISOString(),
      };
      return commitAccessPreflightResult(rootPath, nextState, previousState, snapshot);
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
export const chatLastError = derived(chatRuntimeState, ($runtime) => $runtime.lastError);
export const chatCanRetryLastTurn = derived(chatRuntimeState, ($runtime) =>
  Boolean($runtime.lastFailedTurnId && !$runtime.isGenerating),
);

export const chatAgentIndex = derived(chatStore, ($chatStore) => {
  const root = $chatStore.activeWorkspaceRoot;
  if (!root) {
    return [];
  }
  return [...($chatStore.workspaces[root]?.agentIndex ?? [])];
});

export const chatActiveAgentId = derived(chatStore, ($chatStore) => {
  const root = $chatStore.activeWorkspaceRoot;
  if (!root) {
    return null;
  }
  return $chatStore.workspaces[root]?.activeAgentId ?? null;
});

export function formatCompactionNotice(compactedMessageCount: number): string {
  const label = compactedMessageCount === 1 ? "message" : "messages";
  return `${compactedMessageCount} older ${label} compacted to stay within chat retention limits.`;
}
