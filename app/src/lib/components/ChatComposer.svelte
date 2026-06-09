<script lang="ts">
  import {
    listSelectableChatConnections,
    listSelectableModelsForConnection,
    resolveActiveChatConnectionSelection,
  } from "../ai/providers/selection";
  import { listSelectableChatModes } from "../ai/modes/resolve";
  import type {
    AppSettingsState,
    AppProviderSettings,
    ChatMessage,
    ChatThreadSnapshot,
    ChatModeId,
    ChatProviderId,
    HttpConnectionSettings,
    ProviderModelCatalogs,
  } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { createComposerSendActions } from "../ai/composerSendActions";
  import { createComposerSelectionActions } from "../ai/composerSelectionActions";
  import {
    syncComposerConnectionFallback,
    syncComposerModeFallback,
    syncComposerModelFallback,
  } from "../ai/composerSelectionEffects";
  import { estimateContextWindowBudget } from "../ai/contextWindowBudget";
  import ChatConnectionPicker from "./ChatConnectionPicker.svelte";
  import ChatModePicker from "./ChatModePicker.svelte";
  import "../styles/chat-composer.css";

  interface ComposerError {
    message: string;
    recoveryHint?: string;
  }

  interface Props {
    isBlocked: boolean;
    isDebugSendBlocked: boolean;
    isHttpSendBlocked: boolean;
    isModelSendBlocked: boolean;
    isGenerating: boolean;
    canRetryLastTurn: boolean;
    activeMode: ChatModeId;
    activeProvider: ChatProviderId;
    activeModel: string;
    chatContextKind: "workspace" | "chat-http";
    supportedModes: ChatModeId[];
    providerSettings: AppProviderSettings;
    httpProviderSettings: HttpConnectionSettings;
    httpApiKey: string;
    activeConnectionId?: string;
    providerApiKeys: Partial<Record<string, string>>;
    providerModelCatalogs: ProviderModelCatalogs;
    threadMessages: ChatMessage[];
    threadSummary?: string;
    threadId?: string;
    activeAgentId?: string | null;
    workspaceRootPath: string;
    appSettings: AppSettingsState;
    composerError: ComposerError | null;
    onInlineError?: (message: string) => void;
  }

  let {
    isBlocked,
    isDebugSendBlocked,
    isHttpSendBlocked,
    isModelSendBlocked,
    isGenerating,
    canRetryLastTurn,
    activeMode,
    activeProvider,
    activeModel,
    chatContextKind,
    supportedModes,
    providerSettings,
    httpProviderSettings,
    httpApiKey,
    activeConnectionId = undefined,
    providerApiKeys,
    providerModelCatalogs,
    threadMessages,
    threadSummary = undefined,
    threadId = undefined,
    activeAgentId = null,
    workspaceRootPath,
    appSettings,
    composerError,
    onInlineError = () => {},
  }: Props = $props();

  let draft = $state("");
  let submitInFlight = $state(false);
  let retrying = $state(false);
  let budgetEstimate = $state<{ estimatedTokens: number; estimatedLimitTokens?: number } | null>(
    null,
  );
  let budgetEstimateTimer: ReturnType<typeof setTimeout> | null = null;

  const availableConnections = $derived.by(() => {
    providerSettings;
    chatContextKind;
    httpProviderSettings.enabled;
    httpProviderSettings.baseUrl;
    httpApiKey;
    return listSelectableChatConnections(providerSettings, providerApiKeys, chatContextKind);
  });
  const activeConnectionSelection = $derived.by(() => {
    activeProvider;
    activeConnectionId;
    providerSettings;
    providerApiKeys;
    chatContextKind;
    return resolveActiveChatConnectionSelection(
      activeProvider,
      activeConnectionId,
      providerSettings,
      providerApiKeys,
      chatContextKind,
    );
  });
  const availableModes = $derived.by(() => {
    supportedModes;
    return listSelectableChatModes($appState.settings).filter((mode) => supportedModes.includes(mode.id));
  });
  const availableModels = $derived.by(() => {
    providerModelCatalogs;
    providerSettings;
    activeProvider;
    activeConnectionId;
    return listSelectableModelsForConnection(
      providerModelCatalogs,
      providerSettings,
      activeProvider,
      activeConnectionId,
    );
  });
  const isModeSelectionDisabled = $derived(isGenerating || submitInFlight || retrying);
  const isProviderSelectionDisabled = $derived(isGenerating || submitInFlight || retrying);
  const isModelSelectionDisabled = $derived(isGenerating || submitInFlight || retrying);
  const isSendDisabled = $derived(
    isBlocked ||
      isDebugSendBlocked ||
      isHttpSendBlocked ||
      isModelSendBlocked ||
      isGenerating ||
      submitInFlight ||
      retrying ||
      draft.trim().length === 0,
  );
  const composerDisabled = $derived(
    isBlocked ||
      isDebugSendBlocked ||
      isHttpSendBlocked ||
      isModelSendBlocked ||
      isGenerating ||
      retrying,
  );
  const isRetryDisabled = $derived(
    !canRetryLastTurn ||
      isGenerating ||
      submitInFlight ||
      retrying ||
      isBlocked ||
      isDebugSendBlocked ||
      isHttpSendBlocked ||
      isModelSendBlocked,
  );
  const generationStatus = $derived(isGenerating ? "Generating response…" : "");
  const composerPlaceholder = $derived(
    chatContextKind === "chat-http" ? "Message chat" : "Message agent",
  );
  const budgetDisplayText = $derived.by(() => {
    if (!budgetEstimate) {
      return "Estimating…";
    }
    const used = formatTokenCount(budgetEstimate.estimatedTokens);
    if (!budgetEstimate.estimatedLimitTokens) {
      return `~${used} tokens`;
    }
    return `~${used} / ${formatTokenCount(budgetEstimate.estimatedLimitTokens)}`;
  });
  const budgetStateClass = $derived.by(() => {
    if (!budgetEstimate?.estimatedLimitTokens) {
      return "";
    }
    const ratio = budgetEstimate.estimatedTokens / budgetEstimate.estimatedLimitTokens;
    if (ratio >= 1) {
      return "chat-context-budget--over";
    }
    if (ratio >= 0.85) {
      return "chat-context-budget--near";
    }
    return "";
  });

  const selectionActions = createComposerSelectionActions({
    getActiveMode: () => activeMode,
    getActiveProvider: () => activeProvider,
    getActiveModel: () => activeModel,
    getActiveConnectionId: () => activeConnectionId,
    getProviderSettings: () => providerSettings,
    getProviderApiKeys: () => providerApiKeys,
    getProviderModelCatalogs: () => providerModelCatalogs,
    getChatContextKind: () => chatContextKind,
    getIsModeSelectionDisabled: () => isModeSelectionDisabled,
    getIsProviderSelectionDisabled: () => isProviderSelectionDisabled,
    getIsModelSelectionDisabled: () => isModelSelectionDisabled,
    onInlineError: (message) => onInlineError(message),
  });

  const { selectMode, selectConnection, selectModel } = selectionActions;

  const { submitMessage, retryLastTurn } = createComposerSendActions({
    getDraft: () => draft,
    setDraft: (value) => {
      draft = value;
    },
    getSubmitInFlight: () => submitInFlight,
    setSubmitInFlight: (value) => {
      submitInFlight = value;
    },
    getRetrying: () => retrying,
    setRetrying: (value) => {
      retrying = value;
    },
    getIsBlocked: () => isBlocked,
    getIsDebugSendBlocked: () => isDebugSendBlocked,
    getIsHttpSendBlocked: () => isHttpSendBlocked,
    getIsModelSendBlocked: () => isModelSendBlocked,
    getIsGenerating: () => isGenerating,
    getIsRetryDisabled: () => isRetryDisabled,
    getChatContextKind: () => chatContextKind,
    onInlineError: (message) => onInlineError(message),
  });

  $effect(() => {
    activeConnectionSelection;
    availableConnections;
    isProviderSelectionDisabled;
    syncComposerConnectionFallback({
      activeConnectionSelection,
      availableConnections,
      isProviderSelectionDisabled,
      selectConnection,
    });
  });

  $effect(() => {
    activeMode;
    availableModes;
    isModeSelectionDisabled;
    syncComposerModeFallback({ activeMode, availableModes, isModeSelectionDisabled });
  });

  $effect(() => {
    activeModel;
    availableModels;
    activeProvider;
    activeConnectionId;
    providerSettings;
    providerModelCatalogs;
    isModelSelectionDisabled;
    syncComposerModelFallback({
      activeModel,
      availableModels,
      activeProvider,
      activeConnectionId,
      providerSettings,
      providerModelCatalogs,
      isModelSelectionDisabled,
    });
  });

  $effect(() => {
    draft;
    threadMessages;
    threadSummary;
    threadId;
    activeAgentId;
    activeMode;
    activeProvider;
    activeModel;
    activeConnectionId;
    chatContextKind;
    appSettings;
    workspaceRootPath;

    if (budgetEstimateTimer) {
      clearTimeout(budgetEstimateTimer);
    }

    budgetEstimateTimer = setTimeout(() => {
      budgetEstimate = estimateContextWindowBudget({
        thread: {
          metadata: {
            agentId: activeAgentId ?? "preview-agent",
            threadId: threadId ?? "preview-thread",
            mode: activeMode,
            provider: activeProvider,
            createdAt: "",
            updatedAt: "",
            summary: threadSummary,
            selectedModelId: activeModel,
            connectionId: activeConnectionId,
          },
          messages: threadMessages,
        } satisfies ChatThreadSnapshot,
        workspaceRootPath,
        settings: appSettings,
        scopeKind: chatContextKind,
        draft,
      });
    }, 220);

    return () => {
      if (budgetEstimateTimer) {
        clearTimeout(budgetEstimateTimer);
      }
    };
  });

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }

  function formatTokenCount(value: number): string {
    return new Intl.NumberFormat("en-US", {
      notation: value >= 1000 ? "compact" : "standard",
      maximumFractionDigits: value >= 1000 ? 1 : 0,
    }).format(value);
  }
</script>

<div class="chat-composer" role="group" aria-label="Chat composer">
  {#if composerError}
    <div class="chat-inline-error" role="alert">
      <p class="chat-inline-error-message">{composerError.message}</p>
      {#if composerError.recoveryHint}
        <p class="chat-inline-error-hint">{composerError.recoveryHint}</p>
      {/if}
    </div>
  {/if}
  <textarea
    class="chat-input"
    rows="3"
    bind:value={draft}
    placeholder={composerPlaceholder}
    aria-label="Chat message"
    onkeydown={handleComposerKeydown}
    disabled={composerDisabled}
  ></textarea>
  <div class="chat-composer-actions">
    <div class="chat-composer-toolbar">
      <ChatModePicker
        {availableModes}
        {activeMode}
        disabled={isModeSelectionDisabled}
        onSelectMode={selectMode}
      />
      <ChatConnectionPicker
        {availableConnections}
        {activeConnectionSelection}
        {availableModels}
        {activeModel}
        connectionDisabled={isProviderSelectionDisabled}
        modelDisabled={isModelSelectionDisabled}
        onSelectConnection={(value) => void selectConnection(value)}
        onSelectModel={(value) => void selectModel(value)}
      />
    </div>
    <div class="chat-composer-controls">
      {#if canRetryLastTurn}
        <button
          type="button"
          class="chat-retry-button"
          onclick={() => void retryLastTurn()}
          disabled={isRetryDisabled}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      {/if}
      <span
        class={`chat-context-budget ${budgetStateClass}`.trim()}
        role="status"
        aria-live="polite"
        title="Estimated input tokens (system prompt + retained history + draft)"
      >
        {budgetDisplayText}
      </span>
      <button
        type="button"
        class="chat-send-button"
        onclick={() => void submitMessage()}
        disabled={isSendDisabled}
      >
        {isGenerating ? "Generating…" : "Send"}
      </button>
    </div>
    {#if generationStatus}
      <span class="chat-assistant-status" role="status">{generationStatus}</span>
    {/if}
  </div>
</div>
