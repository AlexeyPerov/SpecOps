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
    chatSessionIndex,
    chatStore,
    formatCompactionNotice,
  } from "../state/chatStore";
  import { draftEntryTitleForScope } from "../services/chatSessions";
  import { isOpencodeEnabled } from "../services/opencodeSettings";
  import { openSettingsDialog } from "../services/settingsDialogUi";
  import { requestConfirm } from "../services/confirmDialogUi";
  import { extractSessionTotals } from "../ai/chatSteps";
  import { abortTurn } from "../ai/chatSendPipeline";
  import {
    DEFAULT_SESSION_RUNTIME_ID,
    EMPTY_SESSION_CATALOG,
    getAgentHostClient,
    loadSessionCatalogs,
    type SessionCatalogSnapshot,
  } from "../services/agentHostRuntime";
import { agentRuntimeDescriptor, isAgentRuntimeId, type AgentRuntimeId } from "../session";
  import ChatBlockedState from "./ChatBlockedState.svelte";
  import ChatComposer from "./ChatComposer.svelte";
  import ChatMessageList from "./ChatMessageList.svelte";
  import SessionTotalBadge from "./SessionTotalBadge.svelte";

  interface Props {
    onDeleteSession?: () => void | Promise<void>;
    /** Restart the supervised agent host (crash/stuck recovery). */
    onRestartRuntime?: () => void | Promise<void>;
  }

  let {
    onDeleteSession,
    onRestartRuntime,
  }: Props = $props();

  let inlineError = $state("");

  const messages = $derived($chatMessages);
  const metadata = $derived($chatMetadata);
  const accessState = $derived($chatAccessState);
  const isGenerating = $derived($chatIsGenerating);
  const canRetryLastTurn = $derived($chatCanRetryLastTurn);
  const lastError = $derived($chatLastError);
  const isBlocked = $derived(
    accessState.status === "blocked" &&
      accessState.reason !== WorkspaceAccessReason.MissingProviderConfig,
  );
  const isMissingProviderConfig = $derived(
    accessState.status === "blocked" &&
      accessState.reason === WorkspaceAccessReason.MissingProviderConfig,
  );
  const isChatBlockedVisible = $derived(isBlocked);
  const isSessionsDisabledForWorkspace = $derived(
    !isOpencodeEnabled($appState.settings.opencode),
  );
  const isEmpty = $derived(messages.length === 0);
  const emptySetupAction = $derived.by(() => {
    if (!isEmpty || isChatBlockedVisible) {
      return null;
    }
    if (isMissingProviderConfig) {
      return {
        hint: "Finish session setup and try again.",
        label: "Open session settings",
        onClick: () => openSettingsDialog("opencode"),
      };
    }
    if (isSessionsDisabledForWorkspace) {
      return {
        hint: OPENCODE_DISABLED_RECOVERY,
        label: "Open session settings",
        onClick: () => openSettingsDialog("opencode"),
      };
    }
    return null;
  });
  /**
   * Cumulative cost / token totals across all assistant messages. Assistant
   * messages accumulate `cost` parts as `usage.recorded` events stream in.
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
  const workspaceRootPath = $derived(chatStore.getActiveWorkspaceRoot() ?? "");

  // --- Neutral runtime identity + catalogs (host discovery / catalogs) -----
  const sessionIndex = $derived($chatSessionIndex);
  const sessionIndexEntry = $derived.by(() => {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return null;
    }
    return sessionIndex.find((entry) => entry.id === sessionId) ?? null;
  });
  const runtimeId = $derived.by(() => {
    const fromEntry = sessionIndexEntry?.runtimeId?.trim() ?? "";
    if (isAgentRuntimeId(fromEntry)) {
      return fromEntry;
    }
    const fromMetadata = metadata?.runtimeId?.trim() ?? "";
    if (isAgentRuntimeId(fromMetadata)) {
      return fromMetadata;
    }
    return DEFAULT_SESSION_RUNTIME_ID;
  });
  const runtimeDescriptor = $derived(agentRuntimeDescriptor(runtimeId as AgentRuntimeId));
  const activeModel = $derived(metadata?.selectedModelId ?? sessionIndexEntry?.modelId ?? "");
  const activeMode = $derived(metadata?.selectedModeId ?? "");

  let catalog = $state<SessionCatalogSnapshot>(EMPTY_SESSION_CATALOG);
  $effect(() => {
    const targetRuntime = runtimeId;
    catalog = { ...EMPTY_SESSION_CATALOG, status: "loading" };
    void loadSessionCatalogs(targetRuntime as AgentRuntimeId).then((snapshot) => {
      // Ignore stale loads after the runtime changed mid-flight.
      if (targetRuntime !== runtimeId) {
        return;
      }
      catalog = snapshot;
    });
  });

  // Default the selected model/mode to the first catalog entry once (creation
  // flow: model → mode before the first send; the runtime is fixed).
  $effect(() => {
    if (isGenerating || catalog.status !== "ready") {
      return;
    }
    if (!activeModel && catalog.models.length > 0) {
      const first = catalog.models[0];
      if (first) {
        chatStore.updateThreadMetadata({ selectedModelId: first.id });
      }
    }
    if (!activeMode && catalog.modes.length > 0) {
      const first = catalog.modes[0];
      if (first) {
        chatStore.updateThreadMetadata({ selectedModeId: first.id });
      }
    }
  });

  // --- Host health ----------------------------------------------------------
  let hostHealthLabel = $state("unknown");
  $effect(() => {
    void isGenerating;
    void workspaceRootPath;
    let cancelled = false;
    void getAgentHostClient()
      .getStatus()
      .then((status) => {
        if (!cancelled) {
          hostHealthLabel = status.running ? status.health : "unknown";
        }
      })
      .catch(() => {
        if (!cancelled) {
          hostHealthLabel = "unknown";
        }
      });
    return () => {
      cancelled = true;
    };
  });

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
  // immediately.
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
      <span
        class="chat-panel-runtime-badge"
        title={`Session runtime: ${runtimeDescriptor.label} (fixed for this session)`}
      >
        {runtimeDescriptor.label}
      </span>
      <span
        class={`chat-panel-health chat-panel-health-{hostHealthLabel}`}
        title={`Agent host health: ${hostHealthLabel}`}
        data-health={hostHealthLabel}
      >
        <span class="chat-panel-health-dot" aria-hidden="true"></span>
        {hostHealthLabel}
      </span>
    </div>
    <div class="chat-panel-header-actions">
      {#if sessionTotals}
        <SessionTotalBadge totals={sessionTotals} />
      {/if}
      {#if onRestartRuntime}
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => void onRestartRuntime?.()}
          title="Restart the supervised agent host (recovery)"
        >
          Restart host
        </button>
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
      emptyHint={
        emptySetupAction?.hint ??
        "Send a prompt to this session. Pick a model and mode, then send."
      }
      emptyActionLabel={emptySetupAction?.label}
      onEmptyAction={emptySetupAction?.onClick}
    />

    <ChatComposer
      {isBlocked}
      {isGenerating}
      {canRetryLastTurn}
      workspaceRootPath={workspaceRootPath}
      {composerError}
      runtimeId={runtimeId}
      runtimeLabel={runtimeDescriptor.label}
      {catalog}
      activeModelId={activeModel}
      activeModeId={activeMode}
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

  .chat-panel-runtime-badge {
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

  .chat-panel-health {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: 9px;
    line-height: 1.5;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .chat-panel-health-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-tertiary, var(--color-text-secondary));
  }

  .chat-panel-health[data-health="healthy"] .chat-panel-health-dot {
    background: var(--color-success, #3fb950);
  }

  .chat-panel-health[data-health="error"] .chat-panel-health-dot,
  .chat-panel-health[data-health="degraded"] .chat-panel-health-dot {
    background: var(--color-error, #f85149);
  }

  .chat-panel-header-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
  }

  /* Header buttons built on .btn .btn-sm (U3.1); only the resting
     muted color and the active state are specific to this area. */
  .chat-panel-header-actions .btn {
    color: var(--color-text-secondary);
  }

  .chat-panel-header-actions .btn:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
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
