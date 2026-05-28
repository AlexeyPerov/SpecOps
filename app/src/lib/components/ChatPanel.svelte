<script lang="ts">
  import {
    getAccessBlockedCopy,
    getDebugProviderDisabledCopy,
    getGlmMissingConfigCopy,
    PROVIDER_REQUEST_FAILURE_RECOVERY,
  } from "../ai/chatErrorCopy";
  import {
    isDebugProviderSendBlocked,
  } from "../ai/providers/debugProviderSettings";
  import {
    isGlmProviderSendBlocked,
  } from "../ai/providers/glmProviderSettings";
  import {
    canSelectChatProvider,
    formatProviderSwitchNotice,
    listSelectableChatProviders,
    resolveDefaultChatProvider,
  } from "../ai/providers/selection";
  import { listModesForProvider } from "../ai/modes/builtins";
  import { sendChatMessage, retryLastChatTurn } from "../ai/sendChatMessage";
  import { parseReviewMessageSections, type ReviewMessageSection } from "../ai/chatReviewContent";
  import type { ChatMessage, ChatModeId, ChatProviderId } from "../domain/contracts";
  import { appState } from "../state/appState";
  import {
    chatAccessState,
    chatCanRetryLastTurn,
    chatIsGenerating,
    chatLastError,
    chatMessages,
    chatMetadata,
    chatStore,
    formatCompactionNotice,
  } from "../state/chatStore";
  import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";
  import { openSettingsDialog } from "../services/settingsDialogUi";

  interface Props {
    onDeleteAgent?: () => void | Promise<void>;
  }

  let { onDeleteAgent }: Props = $props();

  let draft = $state("");
  let sending = $state(false);
  let retrying = $state(false);
  let inlineError = $state("");
  let supportedModes = $state<ChatModeId[]>(["ask", "review"]);

  const messages = $derived($chatMessages);
  const metadata = $derived($chatMetadata);
  const accessState = $derived($chatAccessState);
  const isGenerating = $derived($chatIsGenerating);
  const canRetryLastTurn = $derived($chatCanRetryLastTurn);
  const lastError = $derived($chatLastError);
  const debugProviderSettings = $derived($appState.settings.debugProvider);
  const glmProviderSettings = $derived($appState.settings.glmProvider);
  const glmApiKey = $derived($appState.settings.glmApiKey);
  const availableProviders = $derived(listSelectableChatProviders(debugProviderSettings));
  const availableModes = $derived(listModesForProvider(supportedModes));
  const activeMode = $derived(metadata?.mode ?? "ask");
  const activeProvider = $derived(
    metadata?.provider ?? resolveDefaultChatProvider(debugProviderSettings),
  );
  const isDebugSendBlocked = $derived(
    isDebugProviderSendBlocked(activeProvider, debugProviderSettings),
  );
  const isGlmSendBlocked = $derived(
    isGlmProviderSendBlocked(activeProvider, glmProviderSettings, glmApiKey),
  );
  const isBlocked = $derived(accessState.status === "blocked");
  const isEmpty = $derived(messages.length === 0);
  const activeAgentId = $derived(chatStore.getActiveAgentId());
  const activeAgentTitle = $derived.by(() => {
    if (!activeAgentId) {
      return "Agent";
    }
    return chatStore.getAgentTitle(activeAgentId) ?? "New agent";
  });
  const canDeleteAgent = $derived(activeAgentId !== null);
  const isModeSelectionDisabled = $derived(isGenerating || sending || retrying);
  const isProviderSelectionDisabled = $derived(isGenerating || sending || retrying);
  const compactionNotice = $derived.by(() => {
    const count = metadata?.compactedMessageCount ?? 0;
    return count > 0 ? formatCompactionNotice(count) : "";
  });
  const isSendDisabled = $derived(
    isBlocked ||
      isDebugSendBlocked ||
      isGlmSendBlocked ||
      isGenerating ||
      sending ||
      retrying ||
      draft.trim().length === 0,
  );
  const composerDisabled = $derived(
    isBlocked || isDebugSendBlocked || isGlmSendBlocked || isGenerating || sending || retrying,
  );
  const isRetryDisabled = $derived(
    !canRetryLastTurn || isGenerating || sending || retrying || isBlocked || isDebugSendBlocked || isGlmSendBlocked,
  );
  const glmBlockedCopy = $derived(getGlmMissingConfigCopy());
  const debugBlockedCopy = $derived(getDebugProviderDisabledCopy());
  const accessBlockedCopy = $derived(
    getAccessBlockedCopy(accessState.reason, { activeProvider }),
  );
  const composerError = $derived.by(() => {
    if (inlineError) {
      return { message: inlineError, recoveryHint: composerErrorRecoveryHint(inlineError) };
    }
    if (lastError && !isGenerating && !retrying) {
      return {
        message: lastError.message,
        recoveryHint: PROVIDER_REQUEST_FAILURE_RECOVERY,
      };
    }
    return null;
  });
  const generationStatus = $derived(isGenerating ? "Generating response…" : "");

  $effect(() => {
    activeProvider;
    metadata?.mode;
    debugProviderSettings.enabled;
    glmProviderSettings.enabled;
    glmProviderSettings.baseUrl;
    glmProviderSettings.modelId;
    glmApiKey;
    const root = chatStore.getActiveWorkspaceRoot();
    if (!root) {
      supportedModes = ["ask", "review"];
      return;
    }
    void chatStore.runAccessPreflight().then(async () => {
      const result = await chatStore.checkActiveWorkspaceCapabilities();
      supportedModes =
        result.capabilities?.supportedModes && result.capabilities.supportedModes.length > 0
          ? result.capabilities.supportedModes
          : ["ask", "review"];
    });
  });

  function composerErrorRecoveryHint(message: string): string {
    if (message === glmBlockedCopy.message) {
      return glmBlockedCopy.recoveryHint;
    }
    if (message === debugBlockedCopy.message) {
      return debugBlockedCopy.recoveryHint;
    }
    if (message === accessBlockedCopy.message || message === accessState.message) {
      return accessState.recoveryHint ?? accessBlockedCopy.recoveryHint;
    }
    return PROVIDER_REQUEST_FAILURE_RECOVERY;
  }

  function isProviderSwitchMessage(message: ChatMessage): boolean {
    return message.systemEvent?.type === "provider-switched";
  }

  function messageDisplayContent(message: ChatMessage): string {
    if (message.systemEvent?.type === "provider-switched") {
      return formatProviderSwitchNotice(message.systemEvent);
    }
    return message.content;
  }

  function reviewSectionsForMessage(message: ChatMessage): ReviewMessageSection[] | null {
    if (message.role !== "assistant" || activeMode !== "review") {
      return null;
    }
    return parseReviewMessageSections(message.content);
  }

  function messageRoleLabel(message: ChatMessage): string {
    if (isProviderSwitchMessage(message)) {
      return "Provider switch";
    }
    if (message.role === "assistant") {
      return "Assistant";
    }
    if (message.role === "system") {
      return "System";
    }
    return "You";
  }

  function persistActiveThreadSnapshot(): void {
    const root = chatStore.getActiveWorkspaceRoot();
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
    if (!content || sending || retrying || isBlocked || isDebugSendBlocked || isGlmSendBlocked || isGenerating) {
      return;
    }

    sending = true;
    inlineError = "";
    const result = await sendChatMessage(content);
    if (result.ok) {
      draft = "";
    } else {
      inlineError = result.message;
    }
    sending = false;
  }

  async function retryLastTurn(): Promise<void> {
    if (isRetryDisabled) {
      return;
    }

    retrying = true;
    inlineError = "";
    const result = await retryLastChatTurn();
    if (!result.ok) {
      inlineError = result.message;
    }
    retrying = false;
  }

  async function deleteAgent(): Promise<void> {
    if (!canDeleteAgent || !activeAgentId) {
      return;
    }
    const confirmed = window.confirm(
      `Delete agent "${activeAgentTitle}"? This removes the agent and its chat history. This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    if (onDeleteAgent) {
      await onDeleteAgent();
      return;
    }
    await chatStore.deleteAgent(activeAgentId);
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

  async function selectProvider(nextProvider: ChatProviderId): Promise<void> {
    if (
      nextProvider === activeProvider ||
      isProviderSelectionDisabled ||
      !canSelectChatProvider(nextProvider, debugProviderSettings)
    ) {
      return;
    }

    const result = await chatStore.switchThreadProvider(nextProvider, {
      debugProviderEnabled: debugProviderSettings.enabled,
    });
    if (result.switched) {
      persistActiveThreadSnapshot();
      void chatStore.runAccessPreflight();
    }
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  }
</script>

<section class="chat-panel" aria-label="Agent chat">
  <div class="chat-panel-chrome">
    <div class="chat-panel-header">
      <p class="chat-panel-title">{activeAgentTitle}</p>
      {#if canDeleteAgent}
        <button
          type="button"
          class="chat-delete-button"
          onclick={() => void deleteAgent()}
          disabled={isBlocked || isGenerating || sending || retrying}
        >
          Delete agent
        </button>
      {/if}
    </div>

    {#if isBlocked}
      <div class="chat-blocked-state" role="status" aria-live="polite">
        <p class="chat-blocked-title">{accessBlockedCopy.title}</p>
        <p class="chat-blocked-message">{accessState.message || accessBlockedCopy.message}</p>
        {#if accessState.recoveryHint ?? accessBlockedCopy.recoveryHint}
          <p class="chat-blocked-hint">{accessState.recoveryHint ?? accessBlockedCopy.recoveryHint}</p>
        {/if}
      </div>
    {:else if isGlmSendBlocked}
      <div class="chat-blocked-state" role="status" aria-live="polite">
        <p class="chat-blocked-title">{glmBlockedCopy.title}</p>
        <p class="chat-blocked-message">{glmBlockedCopy.message}</p>
        <p class="chat-blocked-hint">{glmBlockedCopy.recoveryHint}</p>
        <button type="button" class="chat-setup-button" onclick={() => openSettingsDialog("glm")}>
          Open GLM settings
        </button>
      </div>
    {:else if isDebugSendBlocked}
      <div class="chat-blocked-state" role="status" aria-live="polite">
        <p class="chat-blocked-title">{debugBlockedCopy.title}</p>
        <p class="chat-blocked-message">{debugBlockedCopy.message}</p>
        <p class="chat-blocked-hint">{debugBlockedCopy.recoveryHint}</p>
        <button type="button" class="chat-setup-button" onclick={() => openSettingsDialog("debugAi")}>
          Open Debug AI settings
        </button>
      </div>
    {/if}

    {#if compactionNotice}
      <div class="chat-compaction-notice" role="status">
        <p class="chat-compaction-notice-title">Chat history compacted</p>
        <p class="chat-compaction-notice-body">{compactionNotice}</p>
      </div>
    {/if}

    <div class="chat-controls-row">
      <label class="chat-provider-field">
        <span class="chat-mode-label">Provider</span>
        <select
          class="chat-provider-select"
          aria-label="Select chat provider"
          value={activeProvider}
          disabled={isProviderSelectionDisabled}
          onchange={(event) => {
            const next = (event.currentTarget as HTMLSelectElement)
              .value as ChatProviderId;
            void selectProvider(next);
          }}
        >
          {#each availableProviders as provider (provider.id)}
            <option value={provider.id}>{provider.label}</option>
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
              {mode.label}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </div>

  <div class="chat-panel-body">
    {#if isEmpty}
      <div class="chat-empty-state">
        <p class="chat-title">Start chat</p>
        <p class="chat-hint">
          Ask or review ideas for this workspace. Pick a provider and mode above, then send a
          message.
        </p>
      </div>
    {:else}
      <ol class="chat-message-list" aria-label="Conversation">
        {#each messages as message, index (message.id)}
          <li
            class={`chat-message chat-message-${message.role}`}
            class:chat-message-system-event={isProviderSwitchMessage(message)}
            class:chat-message-streaming={isGenerating &&
              message.role === "assistant" &&
              index === messages.length - 1}
          >
            <p class="chat-message-role">{messageRoleLabel(message)}</p>
            {#if reviewSectionsForMessage(message)}
              <div class="chat-review-sections">
                {#each reviewSectionsForMessage(message) ?? [] as section (section.heading)}
                  <section class="chat-review-section">
                    <h3 class="chat-review-section-heading">{section.heading}</h3>
                    <p class="chat-review-section-body">{section.body}</p>
                  </section>
                {/each}
              </div>
            {:else}
              <p class="chat-message-content">
                {#if message.role === "assistant" && message.content.length === 0 && isGenerating && index === messages.length - 1}
                  <span class="chat-streaming-placeholder">Generating…</span>
                {:else}
                  {messageDisplayContent(message)}
                {/if}
              </p>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
  </div>

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
      placeholder="Message agent"
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
      {#if generationStatus}
        <span class="chat-assistant-status" role="status">{generationStatus}</span>
      {/if}
    </div>
  </div>
</section>

<style>
  .chat-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
    min-width: 0;
    padding: var(--space-6) var(--editor-content-padding-x, var(--space-8));
    gap: var(--space-6);
    color: var(--color-text-primary);
    container-type: inline-size;
  }

  .chat-panel-chrome {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-height: 0;
    flex-shrink: 0;
  }

  .chat-panel-body {
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .chat-controls-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
  }

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

  .chat-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .chat-panel-title {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .chat-delete-button {
    min-height: 24px;
    padding: 0 var(--space-6);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, #e06c75 40%, var(--color-border-subtle));
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1;
  }

  .chat-delete-button:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, #e06c75 55%, var(--color-border-subtle));
    cursor: pointer;
  }

  .chat-delete-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-empty-state {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
  }

  .chat-blocked-state {
    border: 1px solid color-mix(in srgb, #e06c75 48%, var(--color-border-subtle));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, #e06c75 9%, var(--color-surface-1));
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .chat-blocked-title {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .chat-blocked-message,
  .chat-blocked-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  .chat-setup-button {
    align-self: flex-start;
    min-height: 26px;
    margin-top: var(--space-2);
    padding: 0 var(--space-8);
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 14%, var(--color-surface-1));
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }

  .chat-setup-button:hover {
    background: color-mix(in srgb, var(--color-accent) 22%, var(--color-surface-1));
  }

  .chat-setup-button:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .chat-compaction-notice {
    margin: 0;
    padding: var(--space-4) var(--space-6);
    border: 1px solid color-mix(in srgb, var(--color-accent) 28%, var(--color-border-subtle));
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .chat-compaction-notice-title {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-compaction-notice-body {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--color-text-secondary);
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

  .chat-message-list {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .chat-message {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    background: var(--color-surface-1);
  }

  .chat-message-user {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }

  .chat-message-assistant {
    border-color: var(--color-border-subtle);
    background: var(--color-surface-1);
  }

  .chat-message-system {
    border-style: dashed;
    border-color: color-mix(in srgb, var(--color-text-secondary) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-text-secondary) 8%, var(--color-surface-1));
  }

  .chat-message-system-event {
    border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }

  .chat-message-role {
    margin: 0 0 var(--space-2) 0;
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-message-content {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .chat-review-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .chat-review-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-subtle);
  }

  .chat-review-section:first-child {
    padding-top: 0;
    border-top: none;
  }

  .chat-review-section-heading {
    margin: 0;
    font-size: 11px;
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-review-section-body {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    color: var(--color-text-secondary);
  }

  .chat-message-streaming {
    border-style: dashed;
  }

  .chat-streaming-placeholder {
    color: var(--color-text-secondary);
    font-style: italic;
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
    align-items: center;
    gap: var(--space-8);
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

  .chat-title {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 12px;
    line-height: 1.4;
    font-weight: 600;
  }

  .chat-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  @container (max-width: 520px) {
    .chat-panel {
      padding-inline: var(--space-4);
      gap: var(--space-4);
    }

    .chat-controls-row {
      flex-direction: column;
      align-items: stretch;
    }

    .chat-provider-field,
    .chat-mode-toolbar {
      width: 100%;
    }

    .chat-provider-select {
      flex: 1;
      max-width: none;
    }
  }
</style>
