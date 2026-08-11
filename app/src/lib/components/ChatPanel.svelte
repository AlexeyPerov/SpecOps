<script lang="ts">
  import {
    getAccessBlockedCopy,
    OPENCODE_DISABLED_RECOVERY,
    PROVIDER_REQUEST_FAILURE_RECOVERY,
    isComposerConfigurationError,
  } from "../ai/chatErrorCopy";
  import { WorkspaceAccessReason } from "../ai/capabilities";
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
  import { getOpencodeCatalog } from "../ai/opencodeCatalog";
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

  const messages = $derived($chatMessages);
  const metadata = $derived($chatMetadata);
  const accessState = $derived($chatAccessState);
  const isGenerating = $derived($chatIsGenerating);
  const canRetryLastTurn = $derived($chatCanRetryLastTurn);
  const lastError = $derived($chatLastError);
  const activeModel = $derived(metadata?.selectedModelId ?? "");
  const activeOpencodeAgentId = $derived(metadata?.opencodeAgentId ?? "");
  const activeOpencodeProviderId = $derived(metadata?.opencodeProviderId ?? "");
  const isBlocked = $derived(
    accessState.status === "blocked" &&
      accessState.reason !== WorkspaceAccessReason.MissingProviderConfig,
  );
  const isMissingProviderConfig = $derived(
    accessState.status === "blocked" &&
      accessState.reason === WorkspaceAccessReason.MissingProviderConfig,
  );
  const isChatBlockedVisible = $derived(isBlocked);
  const isOpencodeDisabledForWorkspace = $derived(
    !isOpencodeEnabled($appState.settings.opencode),
  );
  const isEmpty = $derived(messages.length === 0);
  const emptySetupAction = $derived.by(() => {
    if (!isEmpty || isChatBlockedVisible) {
      return null;
    }
    if (isMissingProviderConfig) {
      return {
        hint: "Finish OpenCode setup and try again.",
        label: "Open OpenCode settings",
        onClick: () => openSettingsDialog("opencode"),
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
   * cumulative `cost` parts.
   */
  const sessionTotals = $derived(extractSessionTotals(messages));
  const activeSessionId = $derived(chatStore.getActiveSessionId());
  const activeAgentTitle = $derived.by(() => {
    if (!activeSessionId) {
      return "Session";
    }
    return chatStore.getSessionTitle(activeSessionId) ?? draftEntryTitleForScope(null);
  });
  const canDeleteSession = $derived(activeSessionId !== null);
  /**
   * M2 session actions are only meaningful for workspace agent tabs with a
   * linked OpenCode session. Draft sessions have no server-side session to
   * fork / revert / share / summarize / export, so the menu is hidden.
   */
  const isWorkspaceSession = $derived(activeSessionId !== null);
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
  const workspaceRootPath = $derived(chatStore.getActiveWorkspaceRoot() ?? "");
  const opencodeCatalog = $derived(getOpencodeCatalog(workspaceRootPath));
  const compactionNotice = $derived.by(() => {
    const count = metadata?.compactedMessageCount ?? 0;
    return count > 0 ? formatCompactionNotice(count) : "";
  });
  const accessBlockedCopy = $derived(getAccessBlockedCopy(accessState.reason));
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

  // Run workspace access preflight on mount so path/access issues surface
  // immediately (the cache-free path; chat-http provider/model inputs no
  // longer factor into readiness).
  $effect(() => {
    workspaceRootPath;
    if (!workspaceRootPath) {
      return;
    }
    void chatStore.runAccessPreflight();
  });

  function composerErrorRecoveryHint(message: string): string {
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
    const confirmed = await requestConfirm({
      title: "Delete session",
      message: `Delete session "${activeAgentTitle}"? This removes the session and its history. This cannot be undone.`,
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

<section class="chat-panel" aria-label="Session chat">
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
          Delete session
        </button>
      {/if}
    </div>
  </div>

  <div class="chat-panel-stack">
    <ChatBlockedState isAccessBlocked={isBlocked} {accessBlockedCopy} />

    <ChatMessageList
      {messages}
      {isEmpty}
      {isGenerating}
      sessionId={activeSessionId}
      {compactionNotice}
      sessionSummary={metadata?.summary ?? ""}
      canForkFromMessage={isWorkspaceSession && Boolean(onForkSession)}
      canRevertFromMessage={isWorkspaceSession && Boolean(onRevertSession)}
      onForkFromMessage={(messageId) => void onForkSession?.(messageId)}
      onRevertFromMessage={(messageId) => void onRevertSession?.(messageId)}
      emptyHint={
        emptySetupAction?.hint ??
        "Send a prompt to this session. Select an OpenCode agent and model, then send."
      }
      emptyActionLabel={emptySetupAction?.label}
      onEmptyAction={emptySetupAction?.onClick}
    />

    <ChatComposer
      {isBlocked}
      {isGenerating}
      {canRetryLastTurn}
      {activeModel}
      threadMessages={messages}
      activeSessionId={activeSessionId}
      workspaceRootPath={workspaceRootPath}
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
