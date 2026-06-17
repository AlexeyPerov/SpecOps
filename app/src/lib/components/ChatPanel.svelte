<script lang="ts">
  import {
    getProviderErrorRecoveryHint,
    getAccessBlockedCopy,
    getDebugProviderDisabledCopy,
    getHttpMissingConfigCopy,
    getLocalInvalidModelBlockedCopy,
    PROVIDER_REQUEST_FAILURE_RECOVERY,
    isComposerConfigurationError,
  } from "../ai/chatErrorCopy";
  import { WorkspaceAccessReason } from "../ai/capabilities";
  import {
    isDebugProviderSendBlocked,
  } from "../ai/providers/debugProviderSettings";
  import { listSelectableChatModes, resolveChatMode } from "../ai/modes/resolve";
  import {
    isHttpConnectionConfigured,
    isHttpProviderSendBlocked,
    resolveHttpConnection,
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
  import { draftEntryTitleForScope } from "../services/chatAgents";
  import { getOpencodeCatalog, refreshOpencodeCatalog } from "../ai/opencodeCatalog";
  import { isOpencodeEnabled } from "../services/opencodeSettings";
  import { extractSessionTotals } from "../ai/chatSteps";
  import ChatBlockedState from "./ChatBlockedState.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessageList from "./ChatMessageList.svelte";
  import SessionTotalBadge from "./SessionTotalBadge.svelte";

  interface Props {
    chatContextKind?: "workspace" | "chat-http";
    onDeleteAgent?: () => void | Promise<void>;
  }

  let { chatContextKind = "workspace", onDeleteAgent }: Props = $props();

  let inlineError = $state("");
  let supportedModes = $state<ChatModeId[]>(["ask", "review"]);

  const messages = $derived($chatMessages);
  const metadata = $derived($chatMetadata);
  const accessState = $derived($chatAccessState);
  const isGenerating = $derived($chatIsGenerating);
  const canRetryLastTurn = $derived($chatCanRetryLastTurn);
  const lastError = $derived($chatLastError);
  const providerSettings = $derived($appState.settings.providerSettings);
  const providerApiKeys = $derived($appState.settings.providerApiKeys);
  const activeConnectionId = $derived(metadata?.connectionId);
  const resolvedHttpConnection = $derived.by(() => {
    providerSettings;
    providerApiKeys;
    activeConnectionId;
    return resolveHttpConnection(providerSettings, providerApiKeys, activeConnectionId);
  });
  const httpProviderSettings = $derived(
    resolvedHttpConnection?.connection ?? providerSettings.http,
  );
  const httpApiKey = $derived(resolvedHttpConnection?.apiKey ?? "");
  const providerModelCatalogs = $derived($appState.settings.providerModelCatalogs);
  const activeMode = $derived(metadata?.mode ?? "ask");
  const activeResolvedMode = $derived(resolveChatMode(activeMode, $appState.settings));
  const activeProvider = $derived.by(() => {
    metadata;
    providerSettings;
    httpProviderSettings;
    httpApiKey;
    return chatStore.getActiveChatProvider();
  });
  const activeModel = $derived.by(() => {
    metadata;
    providerModelCatalogs;
    providerSettings;
    activeProvider;
    activeConnectionId;
    return chatStore.getActiveChatModel(providerModelCatalogs, providerSettings);
  });
  const activeOpencodeAgentId = $derived(metadata?.opencodeAgentId ?? "");
  const activeOpencodeProviderId = $derived(metadata?.opencodeProviderId ?? "");
  const modelCatalogContext = $derived({
    providerSettings,
    connectionId: activeConnectionId,
  });
  const isChatHttpScope = $derived(chatContextKind === "chat-http");
  const localModelValidation = $derived.by(() => {
    if (isChatHttpScope === false) {
      return { ok: true as const, modelId: activeModel };
    }
    return validateLocalModelSelection(
      providerModelCatalogs,
      activeProvider,
      activeModel,
      modelCatalogContext,
    );
  });
  const isModelSendBlocked = $derived(!localModelValidation.ok);
  const modelBlockedCopy = $derived(
    getLocalInvalidModelBlockedCopy(activeModel, formatChatProviderLabel(activeProvider)),
  );
  const isDebugSendBlocked = $derived(
    !isChatHttpScope ? false : isDebugProviderSendBlocked(activeProvider, providerSettings),
  );
  const isHttpSendBlocked = $derived(
    isChatHttpScope
      ? isHttpProviderSendBlocked(activeProvider, httpProviderSettings, httpApiKey)
      : false,
  );
  const isBlocked = $derived(
    accessState.status === "blocked" &&
      accessState.reason !== WorkspaceAccessReason.MissingProviderConfig,
  );
  const isEmpty = $derived(messages.length === 0);
  /**
   * Cumulative cost / token totals across all assistant messages. Workspace
   * agent tabs hydrate from `session.messages` so assistant messages carry
   * cumulative `cost` parts; chat-http/debug threads have no cost payload and
   * this resolves to null (no badge rendered).
   */
  const sessionTotals = $derived(extractSessionTotals(messages));
  const activeAgentId = $derived(chatStore.getActiveAgentId());
  const activeAgentTitle = $derived.by(() => {
    if (!activeAgentId) {
      return isChatHttpScope ? "Chat" : "Agent";
    }
    return (
      chatStore.getAgentTitle(activeAgentId) ??
      draftEntryTitleForScope(isChatHttpScope ? CHAT_HTTP_CONTEXT_ID : null)
    );
  });
  const canDeleteAgent = $derived(activeAgentId !== null);
  const workspaceRootPath = $derived.by(() =>
    chatContextKind === "chat-http"
      ? CHAT_HTTP_CONTEXT_ID
      : chatStore.getActiveWorkspaceRoot() ?? ""
  );
  const opencodeCatalog = $derived.by(() => {
    if (chatContextKind !== "workspace") {
      return null;
    }
    return getOpencodeCatalog(workspaceRootPath);
  });
  const compactionNotice = $derived.by(() => {
    const count = metadata?.compactedMessageCount ?? 0;
    return count > 0 ? formatCompactionNotice(count) : "";
  });
  const httpBlockedCopy = $derived.by(() => {
    const copy = getHttpMissingConfigCopy();
    if (activeProvider !== "http") {
      return copy;
    }
    if (!resolvedHttpConnection) {
      return {
        ...copy,
        message: "No configured HTTP connection is available. Add one in Providers settings.",
      };
    }
    if (
      !isHttpConnectionConfigured(resolvedHttpConnection.connection, resolvedHttpConnection.apiKey)
    ) {
      return {
        ...copy,
        message: `Connection "${resolvedHttpConnection.connection.label}" is not fully configured.`,
      };
    }
    return copy;
  });
  const debugBlockedCopy = $derived(getDebugProviderDisabledCopy(activeProvider));
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
        recoveryHint: getProviderErrorRecoveryHint(lastError.message),
      };
    }
    return null;
  });

  $effect(() => {
    activeProvider;
    activeModel;
    metadata?.mode;
    providerSettings.debugChat.enabled;
    providerSettings.debugWorkspace.enabled;
    httpProviderSettings.enabled;
    httpProviderSettings.baseUrl;
    providerModelCatalogs;
    httpApiKey;
    const selectableModeIds = listSelectableChatModes($appState.settings).map((mode) => mode.id);
    const root = chatStore.getActiveWorkspaceRoot();
    if (!root) {
      supportedModes = selectableModeIds;
      return;
    }
    void chatStore.runAccessPreflight().then(async () => {
      const result = await chatStore.checkActiveWorkspaceCapabilities();
      const providerSupportedModes =
        result.capabilities?.supportedModes && result.capabilities.supportedModes.length > 0
          ? result.capabilities.supportedModes
          : selectableModeIds;
      const allowed = new Set(providerSupportedModes);
      supportedModes = selectableModeIds.filter((modeId) => allowed.has(modeId));
    });
  });

  $effect(() => {
    workspaceRootPath;
    chatContextKind;
    if (chatContextKind !== "workspace" || !workspaceRootPath) {
      return;
    }
    const settings = appState.getSnapshot().settings;
    if (!isOpencodeEnabled(settings.opencode)) {
      return;
    }
    const catalog = getOpencodeCatalog(workspaceRootPath);
    if (catalog.status === "idle" || catalog.status === "error") {
      void refreshOpencodeCatalog(workspaceRootPath);
    }
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
    if (isComposerConfigurationError(message)) {
      return "";
    }
    return PROVIDER_REQUEST_FAILURE_RECOVERY;
  }

  async function deleteAgent(): Promise<void> {
    if (!canDeleteAgent || !activeAgentId) {
      return;
    }
    const targetLabel = isChatHttpScope ? "chat" : "agent";
    const confirmed = window.confirm(
      `Delete ${targetLabel} "${activeAgentTitle}"? This removes the ${targetLabel} and its history. This cannot be undone.`,
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

<section class="chat-panel" aria-label={isChatHttpScope ? "Chats panel" : "Agent chat"}>
  <div class="chat-panel-header">
    <p class="chat-panel-title">{activeAgentTitle}</p>
    <div class="chat-panel-header-actions">
      {#if sessionTotals}
        <SessionTotalBadge totals={sessionTotals} />
      {/if}
      {#if canDeleteAgent}
        <button
          type="button"
          class="chat-delete-button"
          onclick={() => void deleteAgent()}
          disabled={isBlocked || isGenerating}
        >
          {isChatHttpScope ? "Delete chat" : "Delete agent"}
        </button>
      {/if}
    </div>
  </div>

  <div class="chat-panel-stack">
    <ChatBlockedState
      isAccessBlocked={isBlocked}
      isHttpBlocked={isHttpSendBlocked}
      isDebugBlocked={isDebugSendBlocked}
      isModelBlocked={isModelSendBlocked}
      {activeProvider}
      {accessBlockedCopy}
      {httpBlockedCopy}
      {debugBlockedCopy}
      {modelBlockedCopy}
    />

    <ChatMessageList
      {messages}
      {isEmpty}
      {isGenerating}
      activeModeRequiredSections={activeResolvedMode.requiredSections}
      {compactionNotice}
      emptyHint={
        isChatHttpScope
          ? "Send messages with your configured connection. Pick a provider, mode, and model, then send."
          : "Send a prompt to this workspace agent. Select an agent and model from OpenCode, then send."
      }
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
      {chatContextKind}
      {supportedModes}
      {providerSettings}
      {httpProviderSettings}
      {httpApiKey}
      {activeConnectionId}
      {providerApiKeys}
      {providerModelCatalogs}
      threadMessages={messages}
      threadSummary={metadata?.summary}
      threadId={metadata?.threadId}
      activeAgentId={activeAgentId}
      workspaceRootPath={workspaceRootPath}
      appSettings={$appState.settings}
      {composerError}
      {opencodeCatalog}
      {activeOpencodeAgentId}
      {activeOpencodeProviderId}
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

  .chat-panel-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
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
