<script lang="ts">
  import {
    getDebugProviderSendBlockHint,
    isDebugProviderSendBlocked,
  } from "../ai/providers/debugProviderSettings";
  import {
    canSelectChatProvider,
    formatProviderSwitchNotice,
    listSelectableChatProviders,
    resolveDefaultChatProvider,
  } from "../ai/providers/selection";
  import { sendChatMessage } from "../ai/sendChatMessage";
  import { listBuiltinChatModes, listModesForProvider } from "../ai/modes/builtins";
  import { WorkspaceAccessReason } from "../ai/capabilities";
  import type { ChatMessage, ChatModeId, ChatProviderId } from "../domain/contracts";
  import { appState } from "../state/appState";
  import {
    chatAccessState,
    chatHasThread,
    chatIsGenerating,
    chatLastError,
    chatMessages,
    chatMetadata,
    chatStore,
    formatCompactionNotice,
  } from "../state/chatStore";
  import { scheduleAgentThreadFilePersistence } from "../services/chatPersistence";

  let draft = $state("");
  let sending = $state(false);
  let inlineError = $state("");
  let supportedModes = $state<ChatModeId[]>(["ask", "review"]);

  const messages = $derived($chatMessages);
  const metadata = $derived($chatMetadata);
  const hasThread = $derived($chatHasThread);
  const accessState = $derived($chatAccessState);
  const isGenerating = $derived($chatIsGenerating);
  const lastError = $derived($chatLastError);
  const debugProviderSettings = $derived($appState.settings.debugProvider);
  const availableProviders = $derived(listSelectableChatProviders(debugProviderSettings));
  const availableModes = $derived(listModesForProvider(supportedModes));
  const activeMode = $derived(metadata?.mode ?? "ask");
  const activeProvider = $derived(
    metadata?.provider ?? resolveDefaultChatProvider(debugProviderSettings),
  );
  const isDebugSendBlocked = $derived(
    isDebugProviderSendBlocked(activeProvider, debugProviderSettings),
  );
  const isBlocked = $derived(accessState.status === "blocked");
  const isEmpty = $derived(messages.length === 0);
  const canClearHistory = $derived(hasThread || !isEmpty);
  const isModeSelectionDisabled = $derived(isGenerating || sending);
  const isProviderSelectionDisabled = $derived(isGenerating || sending);
  const compactionNotice = $derived.by(() => {
    const count = metadata?.compactedMessageCount ?? 0;
    return count > 0 ? formatCompactionNotice(count) : "";
  });
  const isSendDisabled = $derived(
    isBlocked ||
      isDebugSendBlocked ||
      isGenerating ||
      sending ||
      draft.trim().length === 0,
  );
  const composerDisabled = $derived(isBlocked || isDebugSendBlocked || isGenerating || sending);
  const generationStatus = $derived.by(() => {
    if (isGenerating) {
      return "Generating response…";
    }
    if (lastError) {
      return lastError.message;
    }
    return "";
  });
  const blockedMessage = $derived.by(() => {
    if (!isBlocked) {
      return "";
    }
    if (accessState.reason === WorkspaceAccessReason.WorkspacePathInaccessible) {
      return "AI cannot read files in this workspace because the path is currently inaccessible.";
    }
    if (accessState.reason === WorkspaceAccessReason.MissingProviderConfig) {
      return "AI cannot run because provider setup is incomplete for this workspace.";
    }
    if (accessState.reason === WorkspaceAccessReason.ProviderUnsupported) {
      return "AI cannot read files in this workspace with the current provider.";
    }
    return "AI cannot read files in this workspace.";
  });

  $effect(() => {
    activeProvider;
    metadata?.mode;
    debugProviderSettings.enabled;
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

  function isProviderSwitchMessage(message: ChatMessage): boolean {
    return message.systemEvent?.type === "provider-switched";
  }

  function messageDisplayContent(message: ChatMessage): string {
    if (message.systemEvent?.type === "provider-switched") {
      return formatProviderSwitchNotice(message.systemEvent);
    }
    return message.content;
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
    if (!root || !agentId || !thread) {
      return;
    }
    scheduleAgentThreadFilePersistence(root, agentId, {
      version: 1,
      thread,
    });
  }

  async function submitMessage(): Promise<void> {
    const content = draft.trim();
    if (!content || sending || isBlocked || isDebugSendBlocked || isGenerating) {
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

  async function clearChatHistory(): Promise<void> {
    if (!canClearHistory) {
      return;
    }
    const confirmed = window.confirm(
      "Clear all chat history for this workspace? This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }
    await chatStore.clearActiveWorkspaceChatHistory();
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

<section class="chat-panel" aria-label="Workspace chat">
  <div class="chat-panel-chrome">
    <div class="chat-panel-header">
      <p class="chat-panel-title">Workspace chat</p>
      {#if canClearHistory}
        <button
          type="button"
          class="chat-clear-button"
          onclick={() => void clearChatHistory()}
          disabled={isBlocked}
        >
          Clear workspace chat history
        </button>
      {/if}
    </div>

    {#if isBlocked}
      <div class="chat-blocked-state" role="status" aria-live="polite">
        <p class="chat-blocked-title">AI cannot read files in this workspace.</p>
        <p class="chat-blocked-message">{blockedMessage}</p>
        {#if accessState.recoveryHint}
          <p class="chat-blocked-hint">{accessState.recoveryHint}</p>
        {/if}
      </div>
    {:else if isDebugSendBlocked}
      <div class="chat-blocked-state" role="status" aria-live="polite">
        <p class="chat-blocked-title">Debug provider is disabled.</p>
        <p class="chat-blocked-message">{getDebugProviderSendBlockHint()}</p>
      </div>
    {/if}

    {#if compactionNotice}
      <p class="chat-compaction-notice" role="status">{compactionNotice}</p>
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
            <p class="chat-message-content">
              {#if message.role === "assistant" && message.content.length === 0 && isGenerating && index === messages.length - 1}
                <span class="chat-streaming-placeholder">Generating…</span>
              {:else}
                {messageDisplayContent(message)}
              {/if}
            </p>
          </li>
        {/each}
      </ol>
    {/if}
  </div>

  <div class="chat-composer" role="group" aria-label="Chat composer">
    {#if inlineError}
      <p class="chat-inline-error" role="alert">{inlineError}</p>
    {:else if lastError && !isGenerating}
      <p class="chat-inline-error" role="alert">{lastError.message}</p>
    {/if}
    <textarea
      class="chat-input"
      rows="3"
      bind:value={draft}
      placeholder="Message workspace chat"
      aria-label="Chat message"
      onkeydown={handleComposerKeydown}
      disabled={composerDisabled}
    ></textarea>
    <div class="chat-composer-actions">
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
    padding: var(--space-6) var(--editor-content-padding-x, var(--space-8));
    gap: var(--space-6);
    color: var(--color-text-primary);
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

  .chat-clear-button {
    min-height: 24px;
    padding: 0 var(--space-6);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1;
  }

  .chat-clear-button:hover:not(:disabled) {
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .chat-clear-button:disabled {
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

  .chat-compaction-notice {
    margin: 0;
    padding: var(--space-4) var(--space-6);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-secondary) 6%, var(--color-surface-1));
    font-size: 11px;
    line-height: 1.4;
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
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-primary);
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
</style>
