<script lang="ts">
  import { chatStore } from "../state/chatStore";
  import { createComposerSendActions, persistActiveThreadSnapshot } from "../ai/composerSendActions";
  import SessionCatalogPicker from "./SessionCatalogPicker.svelte";
  import AttachmentTray from "./AttachmentTray.svelte";
  import {
    buildSendContext,
    inferAttachmentMime,
    isImageMime,
    type ComposerAttachment,
  } from "../ai/composerContext";
  import {
    createComposerPromptQueue,
    type QueuedPrompt,
  } from "../ai/composerPromptQueue";
  import {
    loadPromptHistory,
    nextHistoryDown,
    nextHistoryUp,
    type PromptHistoryStore,
  } from "../services/promptHistory";
  import type {
    SessionCatalogSnapshot,
  } from "../services/agentHostRuntime";
  import type { ChatQueueMode } from "../ai/chatSendPipeline";
  import "../styles/chat-composer.css";

  interface ComposerError {
    message: string;
    recoveryHint?: string;
  }

  interface Props {
    isBlocked: boolean;
    isGenerating: boolean;
    canRetryLastTurn: boolean;
    workspaceRootPath: string;
    composerError: ComposerError | null;
    /** Neutral runtime/model/mode catalog for the session's fixed runtime. */
    runtimeId: string;
    runtimeLabel: string;
    catalog: SessionCatalogSnapshot;
    activeModelId: string;
    activeModeId: string;
    /**
     * Aborts the running turn (steer mode). Optional — when omitted, steer
     * falls back to plain queueing.
     */
    onAbortTurn?: () => void;
    onInlineError?: (message: string) => void;
  }

  let {
    isBlocked,
    isGenerating,
    canRetryLastTurn,
    workspaceRootPath,
    composerError,
    runtimeId,
    runtimeLabel,
    catalog,
    activeModelId,
    activeModeId,
    onAbortTurn,
    onInlineError = () => {},
  }: Props = $props();

  let draft = $state("");
  let submitInFlight = $state(false);
  let retrying = $state(false);

  let textareaEl: HTMLTextAreaElement | null = null;

  let attachments = $state<ComposerAttachment[]>([]);
  let attachmentCounter = 0;

  let historyStore = $state<PromptHistoryStore | null>(null);
  let historyIndex = $state(-1);

  const promptQueue = createComposerPromptQueue();
  let queueSnapshot = $state<{ items: QueuedPrompt[] }>({ items: [] });
  let queueMode = $state<ChatQueueMode>("queue");
  let lastWorkspaceForHistory = "";

  const queuedItems = $derived(queueSnapshot.items);

  // Load prompt history once per workspace.
  $effect(() => {
    if (workspaceRootPath.length === 0) {
      return;
    }
    if (workspaceRootPath === lastWorkspaceForHistory) {
      return;
    }
    lastWorkspaceForHistory = workspaceRootPath;
    void loadPromptHistory(workspaceRootPath).then((store) => {
      historyStore = store;
      historyIndex = -1;
    });
  });

  // Drain queue-mode prompts once a running turn completes. Watches the
  // isGenerating transition so we deliver exactly once after the turn ends.
  let wasGenerating = false;
  $effect(() => {
    if (isGenerating) {
      wasGenerating = true;
      return;
    }
    if (!wasGenerating) {
      return;
    }
    wasGenerating = false;
    const next = promptQueue.takeNextDeliverable();
    if (!next) {
      return;
    }
    // Drop the drained prompt from the visible queue, then send it as a fresh
    // turn. Errors surface via onInlineError.
    refreshQueue();
    void submitMessage({
      ...(next.context ? { context: next.context } : {}),
      onAfterSend: (prompt) => {
        historyStore?.record(prompt);
        historyIndex = -1;
      },
    });
  });

  const isModelSelectionDisabled = $derived(isGenerating || submitInFlight || retrying);
  const isSendDisabled = $derived(
    isBlocked ||
      isGenerating ||
      submitInFlight ||
      retrying ||
      draft.trim().length === 0,
  );
  const composerDisabled = $derived(isBlocked || isGenerating || retrying);
  const isRetryDisabled = $derived(
    !canRetryLastTurn ||
      isGenerating ||
      submitInFlight ||
      retrying ||
      isBlocked,
  );
  const generationStatus = $derived(isGenerating ? "Generating response…" : "");

  function selectModel(nextModelId: string): void {
    if (nextModelId === activeModelId || isModelSelectionDisabled) {
      return;
    }
    const updated = chatStore.updateThreadMetadata({ selectedModelId: nextModelId });
    if (updated) {
      persistActiveThreadSnapshot();
    }
  }

  function selectMode(nextModeId: string): void {
    if (nextModeId === activeModeId || isModelSelectionDisabled) {
      return;
    }
    const updated = chatStore.updateThreadMetadata({ selectedModeId: nextModeId });
    if (updated) {
      persistActiveThreadSnapshot();
    }
  }

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
    getIsGenerating: () => isGenerating,
    getIsRetryDisabled: () => isRetryDisabled,
    onInlineError: (message) => onInlineError(message),
  });

  function handleAddFiles(files: File[]): void {
    const next: ComposerAttachment[] = [];
    for (const file of files) {
      attachmentCounter += 1;
      const mime = inferAttachmentMime(file);
      let url = "";
      try {
        url = URL.createObjectURL(file);
      } catch {
        url = "";
      }
      next.push({
        id: `att-${Date.now()}-${attachmentCounter}`,
        filename: file.name || `attachment-${attachmentCounter}`,
        mime,
        url,
        isImage: isImageMime(mime),
        sizeBytes: typeof file.size === "number" ? file.size : undefined,
      });
    }
    if (next.length > 0) {
      attachments = [...attachments, ...next];
    }
  }

  function handleRemoveAttachment(id: string): void {
    const removed = attachments.find((entry) => entry.id === id);
    if (removed?.url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(removed.url);
      } catch {
        // ignore
      }
    }
    attachments = attachments.filter((entry) => entry.id !== id);
  }

  function cycleHistoryUp(): boolean {
    if (!historyStore) {
      return false;
    }
    const list = historyStore.list();
    const { prompt, index } = nextHistoryUp(list, historyIndex);
    if (prompt === null) {
      return false;
    }
    historyIndex = index;
    draft = prompt;
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.setSelectionRange(prompt.length, prompt.length);
      }
    });
    return true;
  }

  function cycleHistoryDown(): boolean {
    if (!historyStore) {
      return false;
    }
    const list = historyStore.list();
    const { prompt, index } = nextHistoryDown(list, historyIndex);
    if (index === historyIndex) {
      return false;
    }
    historyIndex = index;
    draft = prompt ?? "";
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.setSelectionRange(draft.length, draft.length);
      }
    });
    return true;
  }

  function setQueueMode(mode: ChatQueueMode): void {
    queueMode = mode;
  }

  function refreshQueue(): void {
    queueSnapshot = promptQueue.snapshot();
  }

  function removeQueued(id: string): void {
    promptQueue.remove(id);
    refreshQueue();
  }

  function clearQueued(): void {
    promptQueue.clear();
    refreshQueue();
  }

  /**
   * When a turn is running:
   *  - steer mode → abort the running turn and send the new prompt now.
   *  - queue mode → enqueue the prompt; it's drained after the turn ends.
   * Returns `true` when the prompt was handled (so the caller doesn't fall
   * through to a plain submitMessage).
   */
  function tryEnqueueOrSteer(): boolean {
    if (!isGenerating) {
      return false;
    }
    const content = draft.trim();
    if (content.length === 0) {
      return false;
    }
    const context = buildSendContext({ mentions: [], attachments });
    if (queueMode === "steer") {
      // Interrupt + append: abort the running turn, then send the new prompt
      // immediately. Cleanup runs in the onAfterSend hook of submitMessage.
      onAbortTurn?.();
      // Defer the send to the next microtask so the abort can settle (the
      // store flips isGenerating asynchronously once the turn state clears).
      const prompt = content;
      const ctx = context;
      const snapshotAttachments = attachments;
      draft = "";
      attachments = [];
      queueMicrotask(() => {
        void submitMessage({
          ...(ctx ? { context: ctx } : {}),
          onAfterSend: (sent) => {
            historyStore?.record(sent);
            historyIndex = -1;
            // Revoke any blob URLs from the snapshot we just sent.
            snapshotAttachments.forEach((attachment) => {
              if (attachment.url.startsWith("blob:")) {
                try {
                  URL.revokeObjectURL(attachment.url);
                } catch {
                  // ignore
                }
              }
            });
          },
        });
      });
      return true;
    }
    const entry = promptQueue.enqueue({ prompt: content, mode: "queue", context });
    if (!entry) {
      return false;
    }
    draft = "";
    attachments.forEach((attachment) => {
      if (attachment.url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(attachment.url);
        } catch {
          // ignore
        }
      }
    });
    attachments = [];
    historyIndex = -1;
    refreshQueue();
    return true;
  }

  async function submitOrEnqueue(): Promise<void> {
    if (tryEnqueueOrSteer()) {
      return;
    }
    const context = buildSendContext({ mentions: [], attachments });
    await submitMessage({
      ...(context ? { context } : {}),
      onAfterSend: (prompt) => {
        historyStore?.record(prompt);
        historyIndex = -1;
        attachments.forEach((attachment) => {
          if (attachment.url.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(attachment.url);
            } catch {
              // ignore
            }
          }
        });
        attachments = [];
      },
    });
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    // Prompt history: arrow-up at start of input cycles back; arrow-down
    // at end cycles forward. Only trigger when the caret is at the boundary.
    if (event.key === "ArrowUp" && !event.shiftKey) {
      if (textareaEl && textareaEl.selectionStart === 0 && cycleHistoryUp()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      if (
        textareaEl &&
        textareaEl.selectionStart === draft.length &&
        cycleHistoryDown()
      ) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitOrEnqueue();
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
  {#if queuedItems.length > 0}
    <div class="chat-queued-prompts" role="group" aria-label="Queued prompts">
      <div class="chat-queued-prompts-header">
        <span class="chat-queued-prompts-label">
          Queued ({queuedItems.length})
        </span>
        <div class="chat-queued-mode" role="group" aria-label="Queue mode">
          <button
            type="button"
            class={`chat-queued-mode-btn${queueMode === "queue" ? " is-active" : ""}`}
            aria-pressed={queueMode === "queue"}
            onclick={() => setQueueMode("queue")}
            title="Deliver after the running turn completes"
          >
            Queue
          </button>
          <button
            type="button"
            class={`chat-queued-mode-btn${queueMode === "steer" ? " is-active" : ""}`}
            aria-pressed={queueMode === "steer"}
            onclick={() => setQueueMode("steer")}
            title="Interrupt the running turn and append"
          >
            Steer
          </button>
        </div>
        <button
          type="button"
          class="chat-queued-prompts-clear"
          onclick={clearQueued}
          title="Clear queued prompts"
        >
          Clear
        </button>
      </div>
      <ul class="chat-queued-prompts-list" role="presentation">
        {#each queuedItems as item (item.id)}
          <li class="chat-queued-prompt-chip" title={item.prompt}>
            <span class="chat-queued-prompt-mode">{item.mode === "steer" ? "↳" : "⏳"}</span>
            <span class="chat-queued-prompt-text">{item.prompt}</span>
            <button
              type="button"
              class="chat-queued-prompt-remove"
              aria-label="Remove queued prompt"
              onclick={() => removeQueued(item.id)}
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  <AttachmentTray
    attachments={attachments}
    disabled={composerDisabled}
    onAddFiles={handleAddFiles}
    onRemove={handleRemoveAttachment}
  />
  <div class="chat-input-wrap">
    <textarea
      class="chat-input"
      rows="3"
      bind:value={draft}
      bind:this={textareaEl}
      placeholder="Message session"
      aria-label="Chat message"
      onkeydown={handleComposerKeydown}
      disabled={composerDisabled}
    ></textarea>
  </div>
  <div class="chat-composer-actions">
    <div class="chat-composer-toolbar">
      <SessionCatalogPicker
        {runtimeId}
        {runtimeLabel}
        {catalog}
        activeModelId={activeModelId}
        activeModeId={activeModeId}
        disabled={isModelSelectionDisabled}
        onSelectModel={selectModel}
        onSelectMode={selectMode}
      />
    </div>
    <div class="chat-composer-controls">
      {#if canRetryLastTurn}
        <button
          type="button"
          class="btn btn-danger chat-retry-button"
          onclick={() => void retryLastTurn()}
          disabled={isRetryDisabled}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      {/if}
      <button
        type="button"
        class="btn btn-primary chat-send-button"
        onclick={() => void submitOrEnqueue()}
        disabled={isSendDisabled}
      >
        {isGenerating ? (queuedItems.length > 0 ? "Queue" : "Generating…") : "Send"}
      </button>
    </div>
    {#if generationStatus}
      <span class="chat-assistant-status" role="status">{generationStatus}</span>
    {/if}
  </div>
</div>
