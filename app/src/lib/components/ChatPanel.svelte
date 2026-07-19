<script lang="ts" module>
  import type { ChatModeId } from "../domain/contracts";

  // Cross-mount preflight cache: ChatPanel is destroyed/recreated on every
  // chat-tab switch (only editor tabs are keep-alive today), and without this
  // cache the mount-time $effect re-runs runAccessPreflight + capability IPC
  // on every visit. Entries are keyed by workspace root + a fingerprint of the
  // provider/model/settings inputs that invalidate the result; a short TTL
  // covers tab away-and-back without blocking real provider changes.
  const PREFLIGHT_CACHE_TTL_MS = 15_000;

  interface CachedChatPreflight {
    fingerprint: string;
    supportedModes: ChatModeId[];
    checkedAt: number;
  }

  const preflightCacheByRoot = new Map<string, CachedChatPreflight>();

  /** Test/helper: true when `root` has a non-expired cache entry. */
  export function isChatPreflightCached(root: string): boolean {
    const entry = preflightCacheByRoot.get(root);
    if (!entry) {
      return false;
    }
    return Date.now() - entry.checkedAt < PREFLIGHT_CACHE_TTL_MS;
  }

  /** Test/helper: records a successful preflight for `root`. */
  export function markChatPreflightCached(
    root: string,
    fingerprint: string,
    supportedModes: ChatModeId[],
  ): void {
    preflightCacheByRoot.set(root, {
      fingerprint,
      supportedModes: [...supportedModes],
      checkedAt: Date.now(),
    });
  }

  /** Test-only: clears the cross-mount preflight cache. */
  export function clearChatPreflightCache(): void {
    preflightCacheByRoot.clear();
  }

  function readCachedChatPreflight(
    root: string,
    fingerprint: string,
  ): ChatModeId[] | null {
    const entry = preflightCacheByRoot.get(root);
    if (!entry) {
      return null;
    }
    if (entry.fingerprint !== fingerprint) {
      return null;
    }
    if (Date.now() - entry.checkedAt >= PREFLIGHT_CACHE_TTL_MS) {
      return null;
    }
    return entry.supportedModes;
  }
</script>

<script lang="ts">
  import {
    getProviderErrorRecoveryHint,
    getAccessBlockedCopy,
    getDebugProviderDisabledCopy,
    getHttpMissingConfigCopy,
    getLocalInvalidModelBlockedCopy,
    OPENCODE_DISABLED_RECOVERY,
    PROVIDER_MISSING_CONFIG_RECOVERY,
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
  import { draftEntryTitleForScope } from "../services/chatSessions";
  import { getOpencodeCatalog, refreshOpencodeCatalog } from "../ai/opencodeCatalog";
  import { isOpencodeEnabled } from "../services/opencodeSettings";
  import { openSettingsDialog } from "../services/settingsDialogUi";
  import { requestConfirm } from "../services/confirmDialogUi";
  import { extractSessionTotals } from "../ai/chatSteps";
  import { abortTurn } from "../ai/chatSendPipeline";
  import ChatBlockedState from "./ChatBlockedState.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessageList from "./ChatMessageList.svelte";
  import SessionTotalBadge from "./SessionTotalBadge.svelte";

  interface Props {
    chatContextKind?: "workspace" | "chat-http";
    onDeleteSession?: () => void | Promise<void>;
    /** M2-T3: fork the active session from a message into a new tab. */
    onForkSession?: (messageId?: string) => void | Promise<void>;
    /** M2-T4 undo: revert the active session to a message in place. */
    onRevertSession?: (messageId?: string) => void | Promise<void>;
    /** M2-T4 redo: restore a reverted session in place. */
    onUnrevertSession?: () => void | Promise<void>;
    /** M2-T5: share / unshare the active session. */
    onShareSession?: () => void | Promise<void>;
    onUnshareSession?: () => void | Promise<void>;
    /** M2-T6: generate / refresh the session summary. */
    onSummarizeSession?: () => void | Promise<void>;
    /** M2-T7: export the active transcript to Markdown. */
    onExportSession?: () => void | Promise<void>;
    /** M2-T5: current share URL for the active session, if any. */
    activeShareUrl?: string | null;
    /** M2-T3: parent session id when the active session is a fork. */
    activeParentSessionId?: string | null;
    /** M5-T1: TODO panel toggle availability + state. */
    canToggleTodoPanel?: boolean;
    todoPanelOpen?: boolean;
    onToggleTodoPanel?: () => void;
    /** M5-T2: diff viewer panel toggle availability + state. */
    canToggleDiffPanel?: boolean;
    diffPanelOpen?: boolean;
    onToggleDiffPanel?: () => void;
    /** M5-T5: open the session timeline dialog. */
    onOpenTimeline?: () => void;
  }

  let {
    chatContextKind = "workspace",
    onDeleteSession,
    onForkSession,
    onRevertSession,
    onUnrevertSession,
    onShareSession,
    onUnshareSession,
    onSummarizeSession,
    onExportSession,
    activeShareUrl = null,
    activeParentSessionId = null,
    canToggleTodoPanel = false,
    todoPanelOpen = false,
    onToggleTodoPanel,
    canToggleDiffPanel = false,
    diffPanelOpen = false,
    onToggleDiffPanel,
    onOpenTimeline,
  }: Props = $props();

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
  const isMissingProviderConfig = $derived(
    accessState.status === "blocked" &&
      accessState.reason === WorkspaceAccessReason.MissingProviderConfig,
  );
  const isChatBlockedVisible = $derived(
    (isChatHttpScope && !$appState.settings.chatHttp.enabled) ||
      isBlocked ||
      isHttpSendBlocked ||
      isDebugSendBlocked ||
      isModelSendBlocked,
  );
  const isOpencodeDisabledForWorkspace = $derived(
    !isChatHttpScope && !isOpencodeEnabled($appState.settings.opencode),
  );
  const isEmpty = $derived(messages.length === 0);
  const emptySetupAction = $derived.by(() => {
    if (!isEmpty || isChatBlockedVisible) {
      return null;
    }
    if (isMissingProviderConfig) {
      return {
        hint: PROVIDER_MISSING_CONFIG_RECOVERY,
        label: "Open Providers settings",
        onClick: () => openSettingsDialog("connections"),
      };
    }
    if (isOpencodeDisabledForWorkspace) {
      return {
        hint: OPENCODE_DISABLED_RECOVERY,
        label: "Open OpenCode settings",
        onClick: () => openSettingsDialog("opencode"),
      };
    }
    return null;
  });
  /**
   * Cumulative cost / token totals across all assistant messages. Workspace
   * agent tabs hydrate from `session.messages` so assistant messages carry
   * cumulative `cost` parts; chat-http/debug threads have no cost payload and
   * this resolves to null (no badge rendered).
   */
  const sessionTotals = $derived(extractSessionTotals(messages));
  const activeSessionId = $derived(chatStore.getActiveSessionId());
  const activeAgentTitle = $derived.by(() => {
    if (!activeSessionId) {
      return isChatHttpScope ? "Chat" : "Session";
    }
    return (
      chatStore.getSessionTitle(activeSessionId) ??
      draftEntryTitleForScope(isChatHttpScope ? CHAT_HTTP_CONTEXT_ID : null)
    );
  });
  const canDeleteSession = $derived(activeSessionId !== null);
  /**
   * M2 session actions are only meaningful for workspace agent tabs with a
   * linked OpenCode session. Chat-http / debug threads and draft agents have
   * no server-side session to fork / revert / share / summarize / export, so
   * the menu is hidden entirely for them.
   */
  const isWorkspaceSession = $derived(chatContextKind === "workspace" && activeSessionId !== null);
  const hasSessionActions = $derived(
    isWorkspaceSession &&
      Boolean(
        onForkSession ||
          onRevertSession ||
          onShareSession ||
          onSummarizeSession ||
          onExportSession ||
          onOpenTimeline,
      ),
  );
  const isShared = $derived(Boolean(activeShareUrl));
  const isFork = $derived(Boolean(activeParentSessionId));
  let sessionActionsOpen = $state(false);
  let sessionActionsEl = $state<HTMLDivElement | null>(null);

  function toggleSessionActions(): void {
    sessionActionsOpen = !sessionActionsOpen;
  }

  function closeSessionActions(): void {
    sessionActionsOpen = false;
  }

  function onSessionActionsWindowPointerDown(event: PointerEvent): void {
    if (sessionActionsEl?.contains(event.target as Node)) {
      return;
    }
    closeSessionActions();
  }

  function onSessionActionsKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      closeSessionActions();
    }
  }

  $effect(() => {
    if (!sessionActionsOpen) {
      return;
    }
    window.addEventListener("pointerdown", onSessionActionsWindowPointerDown);
    window.addEventListener("keydown", onSessionActionsKeydown);
    return () => {
      window.removeEventListener("pointerdown", onSessionActionsWindowPointerDown);
      window.removeEventListener("keydown", onSessionActionsKeydown);
    };
  });

  function runSessionAction(fn: (() => void | Promise<void>) | undefined): void {
    closeSessionActions();
    if (fn) {
      void fn();
    }
  }
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
    // Fingerprint the inputs that invalidate supportedModes / access readiness
    // so a provider/model/settings change never reuses a stale cache entry,
    // even inside the TTL window.
    const fingerprint = [
      activeProvider,
      activeModel,
      metadata?.mode ?? "",
      metadata?.connectionId ?? "",
      providerSettings.debugChat.enabled ? "1" : "0",
      providerSettings.debugWorkspace.enabled ? "1" : "0",
      httpProviderSettings.enabled ? "1" : "0",
      httpProviderSettings.baseUrl ?? "",
      httpApiKey.length > 0 ? "key" : "",
      selectableModeIds.join(","),
    ].join("\0");
    const cachedModes = readCachedChatPreflight(root, fingerprint);
    if (cachedModes) {
      supportedModes = cachedModes;
      return;
    }
    void chatStore.runAccessPreflight().then(async () => {
      const result = await chatStore.checkActiveWorkspaceCapabilities();
      const providerSupportedModes =
        result.capabilities?.supportedModes && result.capabilities.supportedModes.length > 0
          ? result.capabilities.supportedModes
          : selectableModeIds;
      const allowed = new Set(providerSupportedModes);
      const nextModes = selectableModeIds.filter((modeId) => allowed.has(modeId));
      supportedModes = nextModes;
      markChatPreflightCached(root, fingerprint, nextModes);
    });
  });

  /**
   * M13.5 — OpenCode catalog (models / providers / agents) is no longer
   * auto-refreshed on session-tab mount. Sidecar is lazy, so the catalog
   * stays empty until the user clicks **Refresh model list** in Settings →
   * Workspaces → OpenCode, or sends the first message (which spawns the
   * sidecar and pulls the catalog as part of the send pipeline). Acceptable
   * tradeoff for not eagerly spawning the sidecar on file/editor activity.
   */

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

  async function deleteSession(): Promise<void> {
    if (!canDeleteSession || !activeSessionId) {
      return;
    }
    const targetLabel = isChatHttpScope ? "chat" : "session";
    const confirmed = await requestConfirm({
      title: `Delete ${targetLabel}`,
      message: `Delete ${targetLabel} "${activeAgentTitle}"? This removes the ${targetLabel} and its history. This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    if (onDeleteSession) {
      await onDeleteSession();
      return;
    }
    await chatStore.deleteSession(activeSessionId);
  }
</script>

<section class="chat-panel" aria-label={isChatHttpScope ? "Chats panel" : "Session chat"}>
  <div class="chat-panel-header">
    <div class="chat-panel-title-group">
      <p class="chat-panel-title">{activeAgentTitle}</p>
      {#if isFork}
        <span class="chat-panel-fork-badge" title={`Forked from ${activeParentSessionId ?? "parent session"}`}>fork</span>
      {/if}
      {#if isShared}
        <span class="chat-panel-share-badge" title={activeShareUrl ?? undefined}>shared</span>
      {/if}
    </div>
    <div class="chat-panel-header-actions">
      {#if sessionTotals}
        <SessionTotalBadge totals={sessionTotals} />
      {/if}
      {#if canToggleTodoPanel}
        <button
          type="button"
          class="btn btn-sm"
          class:chat-todo-toggle-active={todoPanelOpen}
          onclick={() => onToggleTodoPanel?.()}
          aria-pressed={todoPanelOpen}
          title={todoPanelOpen ? "Hide todos" : "Show todos"}
        >
          Todos
        </button>
      {/if}
      {#if canToggleDiffPanel}
        <button
          type="button"
          class="btn btn-sm"
          class:chat-todo-toggle-active={diffPanelOpen}
          onclick={() => onToggleDiffPanel?.()}
          aria-pressed={diffPanelOpen}
          title={diffPanelOpen ? "Hide changes" : "Show file changes"}
        >
          Changes
        </button>
      {/if}
      {#if hasSessionActions}
        <div class="chat-session-actions" bind:this={sessionActionsEl}>
          <button
            type="button"
            class="btn btn-sm"
            onclick={toggleSessionActions}
            aria-haspopup="menu"
            aria-expanded={sessionActionsOpen}
            disabled={isBlocked || isGenerating}
            title="Open OpenCode session actions"
          >
            Session
          </button>
          {#if sessionActionsOpen}
            <div class="chat-session-actions-menu" role="menu">
              {#if onShareSession && !isShared}
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => runSessionAction(onShareSession)}
                  title="Share this OpenCode session"
                >
                  Share…
                </button>
              {/if}
              {#if onUnshareSession && isShared}
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => runSessionAction(onUnshareSession)}
                  title="Stop sharing this OpenCode session"
                >
                  Unshare
                </button>
              {/if}
              {#if onSummarizeSession}
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => runSessionAction(onSummarizeSession)}
                  title="Generate an OpenCode session summary"
                >
                  Summarize
                </button>
              {/if}
              {#if onExportSession}
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => runSessionAction(onExportSession)}
                  title="Export this OpenCode transcript as Markdown"
                >
                  Export transcript…
                </button>
              {/if}
              {#if onOpenTimeline}
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => runSessionAction(onOpenTimeline)}
                  title="Open this OpenCode session timeline"
                >
                  Timeline…
                </button>
              {/if}
              {#if onUnrevertSession}
                <button
                  type="button"
                  role="menuitem"
                  onclick={() => runSessionAction(onUnrevertSession)}
                  title="Redo the last reverted OpenCode session state"
                >
                  Redo reverted
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
      {#if canDeleteSession}
        <button
          type="button"
          class="chat-delete-button"
          onclick={() => void deleteSession()}
          disabled={isBlocked || isGenerating}
        >
          {isChatHttpScope ? "Delete chat" : "Delete session"}
        </button>
      {/if}
    </div>
  </div>

  <div class="chat-panel-stack">
    <ChatBlockedState
      isAccessBlocked={isBlocked}
      isChatHttpFeatureBlocked={isChatHttpScope && !$appState.settings.chatHttp.enabled}
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
      sessionId={activeSessionId}
      activeModeRequiredSections={activeResolvedMode.requiredSections}
      {compactionNotice}
      sessionSummary={metadata?.summary ?? ""}
      canForkFromMessage={isWorkspaceSession && Boolean(onForkSession)}
      canRevertFromMessage={isWorkspaceSession && Boolean(onRevertSession)}
      onForkFromMessage={(messageId) => void onForkSession?.(messageId)}
      onRevertFromMessage={(messageId) => void onRevertSession?.(messageId)}
      emptyHint={
        emptySetupAction?.hint ??
        (isChatHttpScope
          ? "Send messages with your configured connection. Pick a provider, mode, and model, then send."
          : "Send a prompt to this session. Select an OpenCode agent and model, then send.")
      }
      emptyActionLabel={emptySetupAction?.label}
      onEmptyAction={emptySetupAction?.onClick}
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
      activeSessionId={activeSessionId}
      workspaceRootPath={workspaceRootPath}
      appSettings={$appState.settings}
      {composerError}
      {opencodeCatalog}
      {activeOpencodeAgentId}
      {activeOpencodeProviderId}
      onAbortTurn={() => {
        if (activeSessionId) {
          abortTurn(activeSessionId, workspaceRootPath);
        }
      }}
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

  .chat-panel-title-group {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .chat-panel-fork-badge,
  .chat-panel-share-badge {
    display: inline-block;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: 9px;
    line-height: 1.5;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .chat-panel-share-badge {
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle));
    color: var(--color-accent);
  }

  .chat-panel-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  .chat-session-actions {
    position: relative;
    display: inline-flex;
  }

  /* Header toggle buttons built on .btn .btn-sm (U3.1); only the resting
     muted color and the active state are specific to this area. */
  .chat-panel-header-actions .btn {
    color: var(--color-text-secondary);
  }

  .chat-panel-header-actions .btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
  }

  .chat-todo-toggle-active {
    color: var(--color-accent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle));
  }

  .chat-session-actions-menu {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    min-width: 180px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    z-index: 50;
    gap: var(--space-1);
  }

  .chat-session-actions-menu button {
    text-align: left;
    padding: var(--space-3) var(--space-4);
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    font-size: 11px;
    line-height: 1.4;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .chat-session-actions-menu button:hover {
    background: var(--color-hover);
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
    border: 1px solid color-mix(in srgb, var(--color-error) 40%, var(--color-border-subtle));
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1;
  }

  .chat-delete-button:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border-subtle));
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
