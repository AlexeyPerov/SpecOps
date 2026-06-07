<script lang="ts">
  import { sendChatMessage, retryLastChatTurn } from "../ai/sendChatMessage";
  import {
    listSelectableChatConnections,
    listSelectableModelsForConnection,
    parseChatConnectionSelection,
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
  import { chatStore } from "../state/chatStore";
  import { appState } from "../state/appState";
  import { resolveComposerModelId } from "../ai/providers/threadModelCatalog";
  import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";

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

  $effect(() => {
    activeConnectionSelection;
    availableConnections;
    if (
      (activeConnectionSelection &&
        availableConnections.some((connection) => connection.value === activeConnectionSelection)) ||
      isProviderSelectionDisabled
    ) {
      return;
    }
    const fallback = availableConnections[0];
    if (fallback) {
      void selectConnection(fallback.value);
    }
  });

  $effect(() => {
    activeMode;
    availableModes;
    if (isModeSelectionDisabled) {
      return;
    }
    if (availableModes.some((mode) => mode.id === activeMode)) {
      return;
    }
    const fallback = availableModes[0];
    if (fallback) {
      const updated = chatStore.updateThreadMetadata({ mode: fallback.id });
      if (updated) {
        persistActiveThreadSnapshot();
      }
    }
  });

  $effect(() => {
    activeModel;
    availableModels;
    activeProvider;
    activeConnectionId;
    providerSettings;
    providerModelCatalogs;
    if (isModelSelectionDisabled) {
      return;
    }
    const agentId = chatStore.getActiveAgentId();
    if (!agentId) {
      return;
    }
    if (activeModel && availableModels.includes(activeModel)) {
      return;
    }
    const thread = chatStore.getActiveThreadSnapshot(agentId);
    const fallbackModel =
      resolveComposerModelId({
        thread,
        providerId: activeProvider,
        providerSettings,
        providerModelCatalogs,
        connectionId: activeConnectionId,
      }) || availableModels[0];
    if (!fallbackModel || !availableModels.includes(fallbackModel) || fallbackModel === activeModel) {
      return;
    }
    chatStore.updateThreadMetadata({ selectedModelId: fallbackModel }, undefined, agentId);
  });

  function persistActiveThreadSnapshot(): void {
    const root = chatStore.getActiveChatScopeKey();
    const agentId = chatStore.getActiveAgentId();
    const thread = agentId ? chatStore.getActiveThreadSnapshot(agentId) : null;
    if (!root || !agentId || !thread || !thread.messages.some((message) => message.role === "user")) {
      return;
    }
    scheduleAgentThreadFilePersistence(root, agentId, {
      version: 1,
      thread,
    });
  }

  async function submitMessage(): Promise<void> {
    const content = draft.trim();
    if (
      !content ||
      submitInFlight ||
      retrying ||
      isBlocked ||
      isDebugSendBlocked ||
      isHttpSendBlocked ||
      isModelSendBlocked ||
      isGenerating
    ) {
      return;
    }

    submitInFlight = true;
    draft = "";
    onInlineError("");
    try {
      const result = await sendChatMessage(content, undefined, { chatContextKind });
      if (!result.ok) {
        onInlineError(result.message);
      }
    } finally {
      submitInFlight = false;
    }
  }

  async function retryLastTurn(): Promise<void> {
    if (isRetryDisabled) {
      return;
    }

    retrying = true;
    onInlineError("");
    const result = await retryLastChatTurn(undefined, { chatContextKind });
    if (!result.ok) {
      onInlineError(result.message);
    }
    retrying = false;
  }

  function selectMode(nextMode: ChatModeId): void {
    if (nextMode === activeMode || isModeSelectionDisabled) {
      return;
    }
    const updated = chatStore.updateThreadMetadata({ mode: nextMode });
    if (updated) {
      persistActiveThreadSnapshot();
    }
  }

  async function selectConnection(nextValue: string): Promise<void> {
    if (isProviderSelectionDisabled) {
      return;
    }
    const parsed = parseChatConnectionSelection(nextValue);
    if (!parsed) {
      return;
    }
    const currentSelection = resolveActiveChatConnectionSelection(
      activeProvider,
      activeConnectionId,
      providerSettings,
      providerApiKeys,
      chatContextKind,
    );
    if (currentSelection === nextValue) {
      return;
    }
    if (parsed.providerId === "http" && parsed.connectionId) {
      if (activeProvider !== "http") {
        const switchProviderResult = await chatStore.switchThreadProvider("http", {
          providerSettings,
          providerModelCatalogs,
        });
        if (!switchProviderResult.switched) {
          return;
        }
      }
      const switchConnectionResult = chatStore.switchThreadConnection(parsed.connectionId, {
        providerSettings,
        providerModelCatalogs,
      });
      if (switchConnectionResult.switched) {
        persistActiveThreadSnapshot();
        void chatStore.runAccessPreflight();
      } else if (switchConnectionResult.message) {
        onInlineError(switchConnectionResult.message);
      }
      return;
    }
    const result = await chatStore.switchThreadProvider(parsed.providerId, {
      providerSettings,
      providerModelCatalogs,
    });
    if (result.switched) {
      persistActiveThreadSnapshot();
      void chatStore.runAccessPreflight();
    }
  }

  async function selectModel(nextModelId: string): Promise<void> {
    if (nextModelId === activeModel || isModelSelectionDisabled) {
      return;
    }

    const result = await chatStore.switchThreadModel(nextModelId, {
      providerSettings,
      providerModelCatalogs,
    });
    if (result.switched) {
      persistActiveThreadSnapshot();
    } else if (result.message) {
      onInlineError(result.message);
    }
  }

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
    <label class="chat-provider-field">
      <span class="chat-mode-label">Connection</span>
      <select
        class="chat-provider-select"
        aria-label="Select chat connection"
        value={activeConnectionSelection ?? ""}
        disabled={isProviderSelectionDisabled}
        onchange={(event) => {
          const next = (event.currentTarget as HTMLSelectElement).value;
          void selectConnection(next);
        }}
      >
        {#each availableConnections as connection (connection.value)}
          <option value={connection.value}>{connection.label}</option>
        {/each}
      </select>
    </label>
    <label class="chat-provider-field">
      <span class="chat-mode-label">Model</span>
      <select
        class="chat-provider-select"
        aria-label="Select chat model"
        value={activeModel}
        disabled={isModelSelectionDisabled}
        onchange={(event) => {
          const next = (event.currentTarget as HTMLSelectElement).value;
          void selectModel(next);
        }}
      >
        {#each availableModels as modelId (modelId)}
          <option value={modelId}>{modelId}</option>
        {/each}
      </select>
    </label>
    <div class="chat-mode-toolbar" role="group" aria-label="Chat mode">
      <span class="chat-mode-label">Mode</span>
      <div class="chat-mode-options" role="radiogroup" aria-label="Select chat mode">
        {#each availableModes as mode (mode.id)}
          <button
            type="button"
            role="radio"
            class="chat-mode-option"
            class:chat-mode-option-active={activeMode === mode.id}
            aria-checked={activeMode === mode.id}
            disabled={isModeSelectionDisabled}
            onclick={() => selectMode(mode.id)}
          >
            {mode.name}
          </button>
        {/each}
      </div>
    </div>
    {#if generationStatus}
      <span class="chat-assistant-status" role="status">{generationStatus}</span>
    {/if}
  </div>
</div>

<style>
  .chat-provider-field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
  }

  .chat-provider-select {
    min-height: 24px;
    min-width: 120px;
    max-width: 180px;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
    font-size: 11px;
    line-height: 1;
  }

  .chat-provider-select:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-provider-select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-mode-toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }

  .chat-mode-label {
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-mode-options {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 2px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
  }

  .chat-mode-option {
    min-height: 22px;
    padding: 0 var(--space-6);
    border: 1px solid transparent;
    border-radius: calc(var(--radius-sm) - 1px);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1;
  }

  .chat-mode-option:hover:not(:disabled) {
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .chat-mode-option:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-mode-option-active {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-1));
    color: var(--color-text-primary);
  }

  .chat-mode-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-inline-error {
    margin: 0;
    padding: var(--space-4) var(--space-6);
    border: 1px solid color-mix(in srgb, #e06c75 48%, var(--color-border-subtle));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, #e06c75 9%, var(--color-surface-1));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .chat-inline-error-message {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-primary);
  }

  .chat-inline-error-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  .chat-composer {
    border-top: 1px solid var(--color-border-subtle);
    padding-top: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    flex-shrink: 0;
    min-height: 0;
  }

  .chat-input {
    width: 100%;
    resize: vertical;
    min-height: 68px;
    max-height: 200px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: var(--space-6);
    font: inherit;
    font-size: 12px;
    line-height: 1.4;
  }

  .chat-input:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-composer-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }

  .chat-composer-actions .chat-assistant-status {
    margin-left: auto;
  }

  .chat-send-button {
    min-height: 26px;
    padding: 0 var(--space-8);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: color-mix(in srgb, var(--color-accent) 18%, var(--color-surface-1));
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1;
  }

  .chat-retry-button {
    min-height: 26px;
    padding: 0 var(--space-8);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, #e06c75 40%, var(--color-border-subtle));
    background: color-mix(in srgb, #e06c75 9%, var(--color-surface-1));
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1;
  }

  .chat-retry-button:hover:not(:disabled) {
    background: color-mix(in srgb, #e06c75 16%, var(--color-surface-1));
    cursor: pointer;
  }

  .chat-retry-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-send-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 26%, var(--color-surface-1));
    cursor: pointer;
  }

  .chat-send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-assistant-status {
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  @container (max-width: 520px) {
    .chat-composer-actions {
      gap: var(--space-4);
    }

    .chat-provider-field,
    .chat-mode-toolbar {
      flex: 1 1 100%;
    }

    .chat-provider-select {
      flex: 1;
      max-width: none;
    }

    .chat-composer-actions .chat-assistant-status {
      margin-left: 0;
      flex: 1 1 100%;
    }
  }
</style>
