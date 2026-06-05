<script lang="ts">
  import {
    getAccessBlockedCopy,
    getDebugProviderDisabledCopy,
    getHttpMissingConfigCopy,
    getLocalInvalidModelBlockedCopy,
    PROVIDER_REQUEST_FAILURE_RECOVERY,
  } from "../ai/chatErrorCopy";
  import { WorkspaceAccessReason } from "../ai/capabilities";
  import {
    isDebugProviderSendBlocked,
  } from "../ai/providers/debugProviderSettings";
  import {
    isHttpProviderSendBlocked,
  } from "../ai/providers/httpConnectionSettings";
  import {
    formatChatProviderLabel,
  } from "../ai/providers/selection";
  import { validateLocalModelSelection } from "../ai/providers/capabilityChecker";
  import { CHAT_HTTP_CONTEXT_ID, type ChatModeId } from "../domain/contracts";
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
  import { DRAFT_AGENT_TITLE } from "../services/chatAgents";
  import ChatBlockedState from "./ChatBlockedState.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessageList from "./ChatMessageList.svelte";

  interface Props {
    onDeleteAgent?: () => void | Promise<void>;
  }

  let { onDeleteAgent }: Props = $props();

  let inlineError = $state("");
  let supportedModes = $state<ChatModeId[]>(["ask", "review"]);

  const messages = $derived($chatMessages);
  const metadata = $derived($chatMetadata);
  const accessState = $derived($chatAccessState);
  const isGenerating = $derived($chatIsGenerating);
  const canRetryLastTurn = $derived($chatCanRetryLastTurn);
  const lastError = $derived($chatLastError);
  const debugProviderSettings = $derived($appState.settings.providerSettings.debug);
  const httpProviderSettings = $derived($appState.settings.providerSettings.http);
  const httpApiKey = $derived($appState.settings.providerApiKeys.http ?? "");
  const providerModelCatalogs = $derived($appState.settings.providerModelCatalogs);
  const activeMode = $derived(metadata?.mode ?? "ask");
  const activeProvider = $derived.by(() => {
    metadata;
    debugProviderSettings;
    httpProviderSettings;
    httpApiKey;
    return chatStore.getActiveChatProvider();
  });
  const activeModel = $derived.by(() => {
    metadata;
    providerModelCatalogs;
    activeProvider;
    return chatStore.getActiveChatModel(providerModelCatalogs);
  });
  const localModelValidation = $derived(
    validateLocalModelSelection(providerModelCatalogs, activeProvider, activeModel),
  );
  const isModelSendBlocked = $derived(!localModelValidation.ok);
  const modelBlockedCopy = $derived(
    getLocalInvalidModelBlockedCopy(activeModel, formatChatProviderLabel(activeProvider)),
  );
  const isDebugSendBlocked = $derived(
    isDebugProviderSendBlocked(activeProvider, debugProviderSettings),
  );
  const isHttpSendBlocked = $derived(
    isHttpProviderSendBlocked(activeProvider, httpProviderSettings, httpApiKey),
  );
  const isBlocked = $derived(
    accessState.status === "blocked" &&
      accessState.reason !== WorkspaceAccessReason.MissingProviderConfig,
  );
  const isEmpty = $derived(messages.length === 0);
  const isChatHttpScope = $derived(chatStore.getActiveChatScopeKey() === CHAT_HTTP_CONTEXT_ID);
  const activeAgentId = $derived(chatStore.getActiveAgentId());
  const activeAgentTitle = $derived.by(() => {
    if (!activeAgentId) {
      return "Agent";
    }
    return chatStore.getAgentTitle(activeAgentId) ?? DRAFT_AGENT_TITLE;
  });
  const canDeleteAgent = $derived(activeAgentId !== null);
  const compactionNotice = $derived.by(() => {
    const count = metadata?.compactedMessageCount ?? 0;
    return count > 0 ? formatCompactionNotice(count) : "";
  });
  const httpBlockedCopy = $derived(getHttpMissingConfigCopy());
  const debugBlockedCopy = $derived(getDebugProviderDisabledCopy());
  const accessBlockedCopy = $derived(
    getAccessBlockedCopy(accessState.reason, { activeProvider }),
  );
  const composerError = $derived.by(() => {
    if (inlineError) {
      return { message: inlineError, recoveryHint: composerErrorRecoveryHint(inlineError) };
    }
    if (lastError && !isGenerating) {
      return {
        message: lastError.message,
        recoveryHint: PROVIDER_REQUEST_FAILURE_RECOVERY,
      };
    }
    return null;
  });

  $effect(() => {
    activeProvider;
    activeModel;
    metadata?.mode;
    debugProviderSettings.enabled;
    httpProviderSettings.enabled;
    httpProviderSettings.baseUrl;
    providerModelCatalogs;
    httpApiKey;
    const root = chatStore.getActiveWorkspaceRoot();
    if (!root) {
      supportedModes = ["ask"];
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
    if (message === httpBlockedCopy.message) {
      return httpBlockedCopy.recoveryHint;
    }
    if (message === debugBlockedCopy.message) {
      return debugBlockedCopy.recoveryHint;
    }
    if (message === accessBlockedCopy.message || message === accessState.message) {
      return accessState.recoveryHint ?? accessBlockedCopy.recoveryHint;
    }
    return PROVIDER_REQUEST_FAILURE_RECOVERY;
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
</script>

<section class="chat-panel" aria-label="Agent chat">
  <div class="chat-panel-header">
    <p class="chat-panel-title">{activeAgentTitle}</p>
    {#if canDeleteAgent}
      <button
        type="button"
        class="chat-delete-button"
        onclick={() => void deleteAgent()}
        disabled={isBlocked || isGenerating}
      >
        Delete agent
      </button>
    {/if}
  </div>

  <div class="chat-panel-stack">
    <ChatBlockedState
      isAccessBlocked={isBlocked}
      isHttpBlocked={isHttpSendBlocked}
      isDebugBlocked={isDebugSendBlocked}
      isModelBlocked={isModelSendBlocked}
      {accessBlockedCopy}
      {httpBlockedCopy}
      {debugBlockedCopy}
      {modelBlockedCopy}
    />

    <ChatMessageList
      {messages}
      {isEmpty}
      {isGenerating}
      {activeMode}
      {compactionNotice}
    />

    <ChatComposer
      {isBlocked}
      isDebugSendBlocked={isDebugSendBlocked}
      isHttpSendBlocked={isHttpSendBlocked}
      isModelSendBlocked={isModelSendBlocked}
      {isGenerating}
      {canRetryLastTurn}
      {activeMode}
      {activeProvider}
      {activeModel}
      chatContextKind={isChatHttpScope ? "chat-http" : "workspace"}
      {supportedModes}
      {debugProviderSettings}
      {httpProviderSettings}
      {httpApiKey}
      {providerModelCatalogs}
      {composerError}
      onInlineError={(message) => {
        inlineError = message;
      }}
    />
  </div>
</section>

<style>
  .chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    padding: var(--space-6) var(--editor-content-padding-x, var(--space-8));
    gap: var(--space-6);
    color: var(--color-text-primary);
    container-type: inline-size;
  }

  .chat-panel-stack {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: flex-end;
    gap: var(--space-6);
    min-height: 0;
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

  @container (max-width: 520px) {
    .chat-panel {
      padding-inline: var(--space-4);
      gap: var(--space-4);
    }

    .chat-panel-stack {
      gap: var(--space-4);
    }
  }
</style>
