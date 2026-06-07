<script lang="ts">
  import {
    listSelectableChatConnections,
    listSelectableModelsForConnection,
    resolveActiveChatConnectionSelection,
  } from "../ai/providers/selection";
  import { listSelectableChatModes } from "../ai/modes/resolve";
  import type {
    AppProviderSettings,
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
    composerError,
    onInlineError = () => {},
  }: Props = $props();

  let draft = $state("");
  let submitInFlight = $state(false);
  let retrying = $state(false);

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

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
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
    <button
      type="button"
      class="chat-send-button"
      onclick={() => void submitMessage()}
      disabled={isSendDisabled}
    >
      {isGenerating ? "Generating…" : "Send"}
    </button>
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
    <ChatModePicker
      {availableModes}
      {activeMode}
      disabled={isModeSelectionDisabled}
      onSelectMode={selectMode}
    />
    {#if generationStatus}
      <span class="chat-assistant-status" role="status">{generationStatus}</span>
    {/if}
  </div>
</div>
