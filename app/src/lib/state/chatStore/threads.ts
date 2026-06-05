import type {
  ChatMessage,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import type { CapabilityChecker } from "../../ai/capabilities";
import { DEBUG_PROVIDER_SWITCH_BLOCKED_MESSAGE } from "../../ai/chatErrorCopy";
import { compactChatThread } from "../../services/chatRetention";
import { DRAFT_AGENT_TITLE } from "../../services/chatAgents";
import { resolveEffectiveThreadModelId } from "../../ai/providers/capabilityChecker";
import {
  formatModelSwitchNotice,
  formatProviderSwitchNotice,
  resolveProviderSwitchModelId,
} from "../../ai/providers/selection";
import {
  getProviderDefaultModelId,
  isModelInProviderCatalog,
  normalizeProviderModelCatalogs,
} from "../../ai/providers/providerModelCatalog";
import { stubCapabilityChecker } from "./access";
import type {
  ChatModelSwitchOptions,
  ChatProviderSwitchOptions,
  ChatStoreState,
  SwitchThreadModelResult,
  SwitchThreadProviderResult,
} from "./types";
import {
  createAgentId,
  createDraftAgentEntry,
  ensureActiveAgent,
  findAgentIndexEntry,
  isDraftAgentEntry,
  patchAgentIndexEntry,
  promoteDraftAgentIndexEntry,
  resolveTargetAgentId,
} from "./agents";
import {
  applyMetadataPatch,
  cloneThread,
  createThreadMetadata,
  DEFAULT_CHAT_MODE,
  getDefaultChatProvider,
} from "./threadHelpers";
import {
  getOrCreateWorkspaceState,
  patchWorkspaceState,
  resolveWorkspaceRoot,
  threadForAgent,
} from "./workspace";
import { defaultRuntimeState } from "./runtime";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export function createThreadsSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
  getRuntimeState: (agentId?: string) => { isGenerating: boolean };
  capabilityCheckerRef: { current: CapabilityChecker | null };
}) {
  const { update, getSnapshot, getActiveChatScopeKey, getRuntimeState, capabilityCheckerRef } =
    deps;

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityCheckerRef.current ?? stubCapabilityChecker;
  }

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
                title: DRAFT_AGENT_TITLE,
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
                [agentId]: cloneThread(thread),
              },
            },
          },
        };
      });
    },
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
    updateThreadMetadata(
      patch: Partial<Pick<ChatThreadMetadata, "mode" | "provider" | "summary" | "selectedModelId">>,
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
      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      const thread = threadForAgent(getSnapshot(), targetAgentId);
      return thread?.messages ?? [];
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
    getActiveChatProvider(agentId?: string): ChatProviderId {
      return this.getMetadata(agentId)?.provider ?? getDefaultChatProvider();
    },
    getActiveChatModel(providerModelCatalogs: ProviderModelCatalogs, agentId?: string): string {
      const providerId = this.getActiveChatProvider(agentId);
      const normalizedCatalogs = normalizeProviderModelCatalogs(providerModelCatalogs);
      const thread = this.getActiveThreadSnapshot(agentId);
      if (thread) {
        return resolveEffectiveThreadModelId(thread, normalizedCatalogs);
      }
      return getProviderDefaultModelId(normalizedCatalogs, providerId);
    },
    hasThread(agentId?: string): boolean {
      return this.getMetadata(agentId) !== null;
    },
    isEmpty(agentId?: string): boolean {
      return this.getMessages(agentId).length === 0;
    },
    async switchThreadProvider(
      nextProvider: ChatProviderId,
      options: ChatProviderSwitchOptions,
      agentId?: string,
    ): Promise<SwitchThreadProviderResult> {
      const root = getActiveChatScopeKey();
      if (!root) {
        return { switched: false, message: "Open a workspace to switch providers." };
      }

      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      if (!targetAgentId) {
        return { switched: false, message: "Select an agent to switch providers." };
      }

      if (getRuntimeState(targetAgentId).isGenerating) {
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

      const normalizedCatalogs = normalizeProviderModelCatalogs(options.providerModelCatalogs);
      const currentThread = this.getActiveThreadSnapshot(targetAgentId);
      const currentModelId = currentThread
        ? resolveEffectiveThreadModelId(currentThread, normalizedCatalogs)
        : metadata?.selectedModelId;
      const nextSelectedModelId = resolveProviderSwitchModelId(
        normalizedCatalogs,
        nextProvider,
        currentModelId,
      );

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
                { provider: nextProvider, mode: nextMode, selectedModelId: nextSelectedModelId },
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
    async switchThreadModel(
      nextModelId: string,
      options: ChatModelSwitchOptions,
      agentId?: string,
    ): Promise<SwitchThreadModelResult> {
      const root = getActiveChatScopeKey();
      if (!root) {
        return { switched: false, message: "Open a workspace to switch models." };
      }

      const targetAgentId = resolveTargetAgentId(getSnapshot(), agentId);
      if (!targetAgentId) {
        return { switched: false, message: "Select an agent to switch models." };
      }

      if (getRuntimeState(targetAgentId).isGenerating) {
        return {
          switched: false,
          message: "Model cannot be changed while a response is generating.",
        };
      }

      const trimmedModelId = nextModelId.trim();
      if (!trimmedModelId) {
        return { switched: false, message: "Choose a model from the list." };
      }

      const providerId = this.getActiveChatProvider(targetAgentId);
      const normalizedCatalogs = normalizeProviderModelCatalogs(options.providerModelCatalogs);
      if (!isModelInProviderCatalog(normalizedCatalogs, providerId, trimmedModelId)) {
        return {
          switched: false,
          message: "That model is not configured for the active provider.",
        };
      }

      const currentThread = this.getActiveThreadSnapshot(targetAgentId);
      const fromModel = currentThread
        ? resolveEffectiveThreadModelId(currentThread, normalizedCatalogs)
        : null;
      if (fromModel === trimmedModelId) {
        return { switched: false };
      }

      const updatedAt = new Date().toISOString();
      const systemEvent = {
        type: "model-switched" as const,
        fromModel,
        toModel: trimmedModelId,
      };
      const switchMessage: ChatMessage = {
        id: `model-switch-${updatedAt}`,
        role: "system",
        content: formatModelSwitchNotice(systemEvent),
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
                { selectedModelId: trimmedModelId },
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
  };
}
