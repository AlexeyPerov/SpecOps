import type {
  AppProviderSettings,
  ChatMessage,
  ChatProviderId,
  ChatThreadSnapshot,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import type { CapabilityChecker } from "../../ai/capabilities";
import { getDebugProviderSwitchBlockedMessage } from "../../ai/chatErrorCopy";
import {
  coerceProviderForScope,
  isDebugProviderEnabled,
} from "../../ai/providers/debugProviderSettings";
import { resolveEffectiveThreadModelId } from "../../ai/providers/capabilityChecker";
import {
  logChatConnectionSwitch,
  logChatModelSwitch,
  logChatProviderSwitch,
} from "../../ai/chatDiagnostics";
import {
  formatModelSwitchNotice,
  formatProviderSwitchNotice,
  resolveProviderSwitchModelId,
} from "../../ai/providers/selection";
import {
  getProviderDefaultModelId,
  normalizeProviderModelCatalogs,
} from "../../ai/providers/providerModelCatalog";
import { isModelInThreadCatalog, resolveComposerModelId } from "../../ai/providers/threadModelCatalog";
import { resolveHttpConnection } from "../../ai/providers/httpConnectionSettings";
import { stubCapabilityChecker } from "./access";
import type {
  ChatModelSwitchOptions,
  ChatProviderSwitchOptions,
  ChatStoreState,
  SwitchThreadConnectionResult,
  SwitchThreadModelResult,
  SwitchThreadProviderResult,
} from "./types";
import {
  DEFAULT_CHAT_MODE,
  applyMetadataPatch,
  createThreadMetadata,
  getDefaultChatProvider,
  resolveModelForConnection,
} from "./threadHelpers";
import { ensureActiveSession, resolveTargetSessionId } from "./sessions";
import { defaultRuntimeState } from "./runtime";
import { patchWorkspaceState } from "./workspace";

type ChatStoreUpdate = (mutator: (state: ChatStoreState) => ChatStoreState) => void;

export interface ThreadProviderSelectionApi {
  getMetadata(sessionId?: string): import("../../domain/contracts").ChatThreadMetadata | null;
  getActiveThreadSnapshot(sessionId?: string): ChatThreadSnapshot | null;
}

export function createThreadProviderSelectionSlice(deps: {
  update: ChatStoreUpdate;
  getSnapshot: () => ChatStoreState;
  getActiveChatScopeKey: () => string | null;
  getRuntimeState: (sessionId?: string) => { isGenerating: boolean };
  capabilityCheckerRef: { current: CapabilityChecker | null };
  threadMetadataApi: ThreadProviderSelectionApi;
}) {
  const {
    update,
    getSnapshot,
    getActiveChatScopeKey,
    getRuntimeState,
    capabilityCheckerRef,
    threadMetadataApi,
  } = deps;

  function resolveCapabilityChecker(): CapabilityChecker {
    return capabilityCheckerRef.current ?? stubCapabilityChecker;
  }

  function resolveOrEnsureTargetSessionId(sessionId?: string): string | null {
    const existing = resolveTargetSessionId(getSnapshot(), sessionId);
    if (existing) {
      return existing;
    }
    const ensured = ensureActiveSession(getSnapshot());
    if (!ensured) {
      return null;
    }
    update(() => ensured.state);
    return ensured.sessionId;
  }

  return {
    getActiveChatProvider(sessionId?: string): ChatProviderId {
      const root = getActiveChatScopeKey();
      const raw = threadMetadataApi.getMetadata(sessionId)?.provider ?? getDefaultChatProvider();
      if (!root) {
        return raw;
      }
      return coerceProviderForScope(raw, root);
    },
    getActiveChatModel(
      providerModelCatalogs: ProviderModelCatalogs,
      providerSettings?: AppProviderSettings,
      sessionId?: string,
    ): string {
      const providerId = this.getActiveChatProvider(sessionId);
      const thread = threadMetadataApi.getActiveThreadSnapshot(sessionId);
      if (!providerSettings) {
        return getProviderDefaultModelId(
          normalizeProviderModelCatalogs(providerModelCatalogs),
          providerId,
        );
      }
      return resolveComposerModelId({
        thread,
        providerId,
        providerSettings,
        providerModelCatalogs,
        connectionId: thread?.metadata.connectionId,
      });
    },
    async switchThreadProvider(
      nextProvider: ChatProviderId,
      options: ChatProviderSwitchOptions,
      sessionId?: string,
    ): Promise<SwitchThreadProviderResult> {
      const root = getActiveChatScopeKey();
      if (!root) {
        return { switched: false, message: "Open Chat and select a chat to switch providers." };
      }

      const targetSessionId = resolveOrEnsureTargetSessionId(sessionId);
      if (!targetSessionId) {
        return { switched: false, message: "Select a session to switch providers." };
      }

      if (getRuntimeState(targetSessionId).isGenerating) {
        return {
          switched: false,
          message: "Provider cannot be changed while a response is generating.",
        };
      }

      if (
        (nextProvider === "debug-chat" || nextProvider === "debug-workspace") &&
        !isDebugProviderEnabled(nextProvider, options.providerSettings)
      ) {
        return {
          switched: false,
          message: getDebugProviderSwitchBlockedMessage(nextProvider),
        };
      }

      const metadata = threadMetadataApi.getMetadata(targetSessionId);
      const fromProvider = metadata?.provider ?? null;
      if (fromProvider === nextProvider) {
        return { switched: false };
      }

      const normalizedCatalogs = normalizeProviderModelCatalogs(options.providerModelCatalogs);
      const catalogContext = {
        providerSettings: options.providerSettings,
        connectionId: metadata?.connectionId,
      };
      const currentThread = threadMetadataApi.getActiveThreadSnapshot(targetSessionId);
      const currentModelId = currentThread
        ? resolveEffectiveThreadModelId(currentThread, normalizedCatalogs, catalogContext)
        : metadata?.selectedModelId;
      const resolvedConnectionId =
        nextProvider === "http"
          ? resolveHttpConnection(
              options.providerSettings,
              {},
              metadata?.connectionId,
            )?.connection.id
          : undefined;
      const nextSelectedModelId = resolveProviderSwitchModelId(
        normalizedCatalogs,
        nextProvider,
        currentModelId,
        nextProvider === "http"
          ? {
              providerSettings: options.providerSettings,
              connectionId: resolvedConnectionId,
            }
          : undefined,
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
        const thread = workspace.threadsBySessionId[targetSessionId];
        const baseThread =
          thread ??
          ({
            metadata: applyMetadataPatch(
              createThreadMetadata(targetSessionId, updatedAt, root),
              {},
              updatedAt,
            ),
            messages: [],
          } satisfies ChatThreadSnapshot);

        switched = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: {
              ...baseThread,
              metadata: applyMetadataPatch(
                baseThread.metadata,
                {
                  provider: nextProvider,
                  mode: nextMode,
                  selectedModelId: nextSelectedModelId,
                  connectionId: resolvedConnectionId,
                },
                updatedAt,
              ),
              messages: [...baseThread.messages, switchMessage],
            },
          },
          runtimeBySessionId: {
            ...workspace.runtimeBySessionId,
            [targetSessionId]: defaultRuntimeState(),
          },
        });
      });

      logChatProviderSwitch({
        sessionId: targetSessionId,
        fromProvider,
        toProvider: nextProvider,
        connectionId: resolvedConnectionId,
        modelId: nextSelectedModelId,
        switched,
        reason: switched ? undefined : "thread update failed",
      });
      return { switched };
    },
    switchThreadConnection(
      nextConnectionId: string,
      options: ChatProviderSwitchOptions,
      sessionId?: string,
    ): SwitchThreadConnectionResult {
      const root = getActiveChatScopeKey();
      if (!root) {
        return { switched: false, message: "Open Chat and select a chat to switch connections." };
      }
      const targetSessionId = resolveOrEnsureTargetSessionId(sessionId);
      if (!targetSessionId) {
        return { switched: false, message: "Select a chat to switch connections." };
      }
      if (getRuntimeState(targetSessionId).isGenerating) {
        return {
          switched: false,
          message: "Connection cannot be changed while a response is generating.",
        };
      }
      const trimmedConnectionId = nextConnectionId.trim();
      if (!trimmedConnectionId) {
        return { switched: false, message: "Choose a configured connection." };
      }
      const metadata = threadMetadataApi.getMetadata(targetSessionId);
      if (!metadata || metadata.provider !== "http") {
        return { switched: false, message: "Connection switching is available only for HTTP chats." };
      }
      const resolved = resolveHttpConnection(options.providerSettings, {}, trimmedConnectionId);
      if (!resolved || resolved.connection.id !== trimmedConnectionId) {
        return { switched: false, message: "That connection is no longer available." };
      }
      if (metadata.connectionId === trimmedConnectionId) {
        return { switched: false };
      }
      const updatedAt = new Date().toISOString();
      const nextModelId = resolveModelForConnection(
        options.providerModelCatalogs,
        resolved.connection.modelCatalog,
      );
      let switched = false;
      update((state) => {
        const workspace = state.workspaces[root];
        if (!workspace) {
          return state;
        }
        const thread = workspace.threadsBySessionId[targetSessionId];
        const baseThread =
          thread ??
          ({
            metadata: applyMetadataPatch(
              createThreadMetadata(targetSessionId, updatedAt, root),
              { provider: "http", connectionId: trimmedConnectionId, selectedModelId: nextModelId },
              updatedAt,
            ),
            messages: [],
          } satisfies ChatThreadSnapshot);
        switched = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: {
              ...baseThread,
              metadata: applyMetadataPatch(
                baseThread.metadata,
                { connectionId: trimmedConnectionId, selectedModelId: nextModelId },
                updatedAt,
              ),
            },
          },
          runtimeBySessionId: {
            ...workspace.runtimeBySessionId,
            [targetSessionId]: defaultRuntimeState(),
          },
        });
      });
      logChatConnectionSwitch({
        sessionId: targetSessionId,
        fromConnectionId: metadata.connectionId ?? null,
        toConnectionId: trimmedConnectionId,
        modelId: nextModelId,
        switched,
        reason: switched ? undefined : "thread update failed",
      });
      return { switched };
    },
    async switchThreadModel(
      nextModelId: string,
      options: ChatModelSwitchOptions,
      sessionId?: string,
    ): Promise<SwitchThreadModelResult> {
      const root = getActiveChatScopeKey();
      if (!root) {
        return { switched: false, message: "Open Chat and select a chat to switch models." };
      }

      const targetSessionId = resolveOrEnsureTargetSessionId(sessionId);
      if (!targetSessionId) {
        return { switched: false, message: "Select a session to switch models." };
      }

      if (getRuntimeState(targetSessionId).isGenerating) {
        return {
          switched: false,
          message: "Model cannot be changed while a response is generating.",
        };
      }

      const trimmedModelId = nextModelId.trim();
      if (!trimmedModelId) {
        return { switched: false, message: "Choose a model from the list." };
      }

      const providerId = this.getActiveChatProvider(targetSessionId);
      const metadata = threadMetadataApi.getMetadata(targetSessionId);
      const normalizedCatalogs = normalizeProviderModelCatalogs(options.providerModelCatalogs);
      const catalogContext = {
        providerSettings: options.providerSettings,
        connectionId: metadata?.connectionId,
      };
      if (!isModelInThreadCatalog(normalizedCatalogs, providerId, trimmedModelId, catalogContext)) {
        logChatModelSwitch({
          sessionId: targetSessionId,
          providerId,
          connectionId: metadata?.connectionId,
          toModel: trimmedModelId,
          switched: false,
          reason: "model not in thread catalog",
        });
        return {
          switched: false,
          message: "That model is not configured for the active provider.",
        };
      }

      const currentThread = threadMetadataApi.getActiveThreadSnapshot(targetSessionId);
      const fromModel = currentThread
        ? resolveEffectiveThreadModelId(currentThread, normalizedCatalogs, catalogContext)
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
        const thread = workspace.threadsBySessionId[targetSessionId];
        const baseThread =
          thread ??
          ({
            metadata: applyMetadataPatch(
              createThreadMetadata(targetSessionId, updatedAt, root),
              {},
              updatedAt,
            ),
            messages: [],
          } satisfies ChatThreadSnapshot);

        switched = true;
        return patchWorkspaceState(state, root, {
          ...workspace,
          threadsBySessionId: {
            ...workspace.threadsBySessionId,
            [targetSessionId]: {
              ...baseThread,
              metadata: applyMetadataPatch(
                baseThread.metadata,
                { selectedModelId: trimmedModelId },
                updatedAt,
              ),
              messages: [...baseThread.messages, switchMessage],
            },
          },
          runtimeBySessionId: {
            ...workspace.runtimeBySessionId,
            [targetSessionId]: defaultRuntimeState(),
          },
        });
      });

      logChatModelSwitch({
        sessionId: targetSessionId,
        providerId,
        connectionId: metadata?.connectionId,
        fromModel,
        toModel: trimmedModelId,
        switched,
        reason: switched ? undefined : "thread update failed",
      });
      return { switched };
    },
  };
}
