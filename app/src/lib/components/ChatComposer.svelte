<script lang="ts">
  import {
    listSelectableChatConnections,
    listSelectableModelsForConnection,
    listSelectableWorkspaceModels,
    resolveActiveChatConnectionSelection,
  } from "../ai/providers/selection";
  import { listSelectableChatModes } from "../ai/modes/resolve";
  import type {
    AppSettingsState,
    AppProviderSettings,
    ChatMessage,
    ChatThreadSnapshot,
    ChatModeId,
    ChatProviderId,
    HttpConnectionSettings,
    ProviderModelCatalogs,
  } from "../domain/contracts";
  import { appState } from "../state/appState";
  import { chatStore } from "../state/chatStore";
  import { createComposerSendActions, persistActiveThreadSnapshot } from "../ai/composerSendActions";
  import { createComposerSelectionActions } from "../ai/composerSelectionActions";
  import {
    syncComposerConnectionFallback,
    syncComposerModeFallback,
    syncComposerModelFallback,
  } from "../ai/composerSelectionEffects";
  import { estimateContextWindowBudget } from "../ai/contextWindowBudget";
  import type { OpencodeCatalogState } from "../ai/opencodeCatalog";
  import ChatConnectionPicker from "./ChatConnectionPicker.svelte";
  import ChatModePicker from "./ChatModePicker.svelte";
  import WorkspaceCatalogPicker from "./WorkspaceCatalogPicker.svelte";
  import SlashCommandPopover from "./SlashCommandPopover.svelte";
  import MentionPicker from "./MentionPicker.svelte";
  import AttachmentTray from "./AttachmentTray.svelte";
  import {
    buildSlashReplacement,
    filterCommands,
    getOpencodeCommands,
    refreshOpencodeCommands,
    shouldTriggerSlashPopover,
  } from "../ai/backends/opencodeCommands";
  import {
    buildMentionReplacement,
    filterMentionAgents,
    mentionTokenForAgent,
    mentionTokenForFile,
    searchMentionFiles,
    shouldTriggerMentionPicker,
    type MentionAgentEntry,
    type MentionFileEntry,
    type MentionToken,
  } from "../ai/backends/opencodeSearch";
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
  import type { OpencodeAgentEntry, OpencodeCommandEntry } from "../ai/backends/workspaceAgentBackend";
  import type { ChatQueueMode } from "../ai/chatSendPipeline";
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
    threadMessages: ChatMessage[];
    threadSummary?: string;
    threadId?: string;
    activeSessionId?: string | null;
    workspaceRootPath: string;
    appSettings: AppSettingsState;
    composerError: ComposerError | null;
    opencodeCatalog?: OpencodeCatalogState | null;
    activeOpencodeAgentId?: string;
    activeOpencodeProviderId?: string;
    /**
     * Aborts the running workspace-agent turn (M3-T5 steer mode). Optional —
     * when omitted, steer falls back to plain queueing.
     */
    onAbortTurn?: () => void;
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
    threadMessages,
    threadSummary = undefined,
    threadId = undefined,
    activeSessionId = null,
    workspaceRootPath,
    appSettings,
    composerError,
    opencodeCatalog = null,
    activeOpencodeAgentId = "",
    activeOpencodeProviderId = "",
    onAbortTurn,
    onInlineError = () => {},
  }: Props = $props();

  let draft = $state("");
  let submitInFlight = $state(false);
  let retrying = $state(false);
  let budgetEstimate = $state<{ estimatedTokens: number; estimatedLimitTokens?: number } | null>(
    null,
  );
  let budgetEstimateTimer: ReturnType<typeof setTimeout> | null = null;

  // --- M3 composer state -------------------------------------------------
  // Popover / mention picker state. Visible flag is recomputed on every
  // caret change; activeIndex tracks keyboard navigation within the popover.
  let textareaEl: HTMLTextAreaElement | null = null;
  let caret = $state(0);

  let slashState = $state<{ open: boolean; query: string }>({ open: false, query: "" });
  let slashActiveIndex = $state(0);

  let mentionState = $state<{ open: boolean; query: string }>({ open: false, query: "" });
  let mentionActiveIndex = $state(0);
  let mentionFiles = $state<MentionFileEntry[]>([]);
  let mentionFilesLoading = $state(false);
  let mentionFilesError = $state<string | null>(null);
  let mentionSearchTimer: ReturnType<typeof setTimeout> | null = null;

  let mentions = $state<MentionToken[]>([]);
  let attachments = $state<ComposerAttachment[]>([]);
  let attachmentCounter = 0;

  let historyStore = $state<PromptHistoryStore | null>(null);
  let historyIndex = $state(-1);

  const promptQueue = createComposerPromptQueue();
  let queueSnapshot = $state<{ items: QueuedPrompt[] }>({ items: [] });
  let queueMode = $state<ChatQueueMode>("queue");
  let lastWorkspaceForHistory = "";

  const isWorkspace = $derived(chatContextKind === "workspace");

  const commandCatalog = $derived(getOpencodeCommands(workspaceRootPath));
  const filteredCommands = $derived(
    isWorkspace && slashState.open
      ? filterCommands(commandCatalog.commands, slashState.query)
      : [],
  );
  const filteredAgents = $derived(
    isWorkspace && mentionState.open
      ? filterMentionAgents(opencodeCatalog?.agents ?? [], mentionState.query)
      : [],
  );
  // Combined length used for keyboard navigation across files + agents.
  const mentionTotalRows = $derived(mentionFiles.length + filteredAgents.length);

  const hasAttachmentsOrMentions = $derived(attachments.length > 0 || mentions.length > 0);
  const queuedItems = $derived(queueSnapshot.items);

  // --- M3 effects --------------------------------------------------------
  // Load slash commands once per workspace.
  $effect(() => {
    if (!isWorkspace || workspaceRootPath.length === 0) {
      return;
    }
    // Track workspaceRootPath as a dependency.
    workspaceRootPath;
    void refreshOpencodeCommands(workspaceRootPath);
  });

  // Load prompt history once per workspace.
  $effect(() => {
    if (!isWorkspace || workspaceRootPath.length === 0) {
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

  // Debounced file search for the mention picker.
  $effect(() => {
    if (!isWorkspace || !mentionState.open) {
      if (mentionSearchTimer) {
        clearTimeout(mentionSearchTimer);
        mentionSearchTimer = null;
      }
      return;
    }
    const query = mentionState.query;
    if (mentionSearchTimer) {
      clearTimeout(mentionSearchTimer);
    }
    mentionSearchTimer = setTimeout(() => {
      mentionSearchTimer = null;
      if (query.trim().length === 0) {
        mentionFiles = [];
        mentionFilesLoading = false;
        mentionFilesError = null;
        return;
      }
      mentionFilesLoading = true;
      void searchMentionFiles({ workspaceRootPath, query, limit: 20 })
        .then((result) => {
          mentionFiles = result.files;
          mentionFilesError = result.status === "error" ? "File search failed." : null;
        })
        .catch(() => {
          mentionFiles = [];
          mentionFilesError = "File search failed.";
        })
        .finally(() => {
          mentionFilesLoading = false;
        });
    }, 180);
  });

  // Drain queue-mode prompts once a running turn completes. Watches the
  // isGenerating transition so we deliver exactly once after the turn ends.
  let wasGenerating = false;
  $effect(() => {
    if (!isWorkspace) {
      wasGenerating = false;
      return;
    }
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

  const availableConnections = $derived.by(() => {
    if (isWorkspace) {
      return [];
    }
    providerSettings;
    chatContextKind;
    httpProviderSettings.enabled;
    httpProviderSettings.baseUrl;
    httpApiKey;
    return listSelectableChatConnections(providerSettings, providerApiKeys, chatContextKind);
  });
  const activeConnectionSelection = $derived.by(() => {
    if (isWorkspace) {
      return null;
    }
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
    if (isWorkspace) {
      return [];
    }
    supportedModes;
    return listSelectableChatModes($appState.settings).filter((mode) => supportedModes.includes(mode.id));
  });
  const availableModels = $derived.by(() => {
    if (chatContextKind === "workspace" && opencodeCatalog?.status === "loaded" && opencodeCatalog.models.length > 0) {
      return listSelectableWorkspaceModels(opencodeCatalog.models);
    }
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
    chatContextKind === "chat-http" ? "Message chat" : "Message session",
  );
  const budgetDisplayText = $derived.by(() => {
    if (!budgetEstimate) {
      return "Estimating…";
    }
    const used = formatTokenCount(budgetEstimate.estimatedTokens);
    if (!budgetEstimate.estimatedLimitTokens) {
      return `~${used} tokens`;
    }
    return `~${used} / ${formatTokenCount(budgetEstimate.estimatedLimitTokens)}`;
  });
  const budgetStateClass = $derived.by(() => {
    if (!budgetEstimate?.estimatedLimitTokens) {
      return "";
    }
    const ratio = budgetEstimate.estimatedTokens / budgetEstimate.estimatedLimitTokens;
    if (ratio >= 1) {
      return "chat-context-budget--over";
    }
    if (ratio >= 0.85) {
      return "chat-context-budget--near";
    }
    return "";
  });

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

  function selectOpencodeAgent(agentId: string): void {
    if (agentId === activeOpencodeAgentId || isModelSelectionDisabled) {
      return;
    }
    const updated = chatStore.updateThreadMetadata({ opencodeAgentId: agentId });
    if (updated) {
      persistActiveThreadSnapshot();
    }
  }

  function selectOpencodeProvider(providerId: string): void {
    if (providerId === activeOpencodeProviderId || isModelSelectionDisabled) {
      return;
    }
    const updated = chatStore.updateThreadMetadata({ opencodeProviderId: providerId });
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
    getIsDebugSendBlocked: () => isDebugSendBlocked,
    getIsHttpSendBlocked: () => isHttpSendBlocked,
    getIsModelSendBlocked: () => isModelSendBlocked,
    getIsGenerating: () => isGenerating,
    getIsRetryDisabled: () => isRetryDisabled,
    getChatContextKind: () => chatContextKind,
    onInlineError: (message) => onInlineError(message),
  });

  $effect(() => {
    if (isWorkspace) {
      return;
    }
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
    if (isWorkspace) {
      return;
    }
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
    if (isWorkspace) {
      if (isModelSelectionDisabled) {
        return;
      }
      if (!activeModel && availableModels.length > 0) {
        const updated = chatStore.updateThreadMetadata({ selectedModelId: availableModels[0] });
        if (updated) {
          persistActiveThreadSnapshot();
        }
      }
      return;
    }
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

  $effect(() => {
    draft;
    threadMessages;
    threadSummary;
    threadId;
    activeSessionId;
    activeMode;
    activeProvider;
    activeModel;
    activeConnectionId;
    chatContextKind;
    appSettings;
    workspaceRootPath;

    if (budgetEstimateTimer) {
      clearTimeout(budgetEstimateTimer);
    }

    budgetEstimateTimer = setTimeout(() => {
      budgetEstimate = estimateContextWindowBudget({
        thread: {
          metadata: {
            sessionId: activeSessionId ?? "preview-session",
            threadId: threadId ?? "preview-thread",
            mode: activeMode,
            provider: activeProvider,
            createdAt: "",
            updatedAt: "",
            summary: threadSummary,
            selectedModelId: activeModel,
            connectionId: activeConnectionId,
          },
          messages: threadMessages,
        } satisfies ChatThreadSnapshot,
        workspaceRootPath,
        settings: appSettings,
        scopeKind: chatContextKind,
        draft,
      });
    }, 220);

    return () => {
      if (budgetEstimateTimer) {
        clearTimeout(budgetEstimateTimer);
      }
    };
  });

  function updateCaret(): void {
    if (textareaEl) {
      caret = textareaEl.selectionStart ?? draft.length;
    }
  }

  function refreshTriggers(): void {
    if (!isWorkspace) {
      slashState = { open: false, query: "" };
      mentionState = { open: false, query: "" };
      return;
    }
    const slash = shouldTriggerSlashPopover(draft, caret);
    if (slash.trigger !== slashState.open || slash.query !== slashState.query) {
      slashState = { open: slash.trigger, query: slash.query };
      slashActiveIndex = 0;
    }
    const mention = shouldTriggerMentionPicker(draft, caret);
    if (mention.trigger !== mentionState.open || mention.query !== mentionState.query) {
      mentionState = { open: mention.trigger, query: mention.query };
      mentionActiveIndex = 0;
    }
  }

  function handleInput(): void {
    updateCaret();
    refreshTriggers();
    // Reset history navigation whenever the user types fresh content.
    if (historyIndex !== -1) {
      historyIndex = -1;
    }
  }

  function applySlashCommand(command: OpencodeCommandEntry): void {
    const { value, caret: nextCaret } = buildSlashReplacement({
      value: draft,
      caret,
      template: command.template,
    });
    draft = value;
    caret = nextCaret;
    slashState = { open: false, query: "" };
    slashActiveIndex = 0;
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.setSelectionRange(caret, caret);
      }
    });
  }

  function applyFileMention(file: MentionFileEntry): void {
    const token = mentionTokenForFile(file.path);
    insertMentionToken(token);
  }

  function applyAgentMention(agent: MentionAgentEntry): void {
    const token = mentionTokenForAgent(agent.id, agent.name);
    insertMentionToken(token);
  }

  function insertMentionToken(token: MentionToken): void {
    const { value, caret: nextCaret } = buildMentionReplacement({
      value: draft,
      caret,
      token,
    });
    draft = value;
    caret = nextCaret;
    mentions = [...mentions, token];
    mentionState = { open: false, query: "" };
    mentionActiveIndex = 0;
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.setSelectionRange(caret, caret);
      }
    });
  }

  function removeMention(token: MentionToken): void {
    mentions = mentions.filter((entry) => entry !== token);
  }

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
        caret = prompt.length;
        textareaEl.setSelectionRange(caret, caret);
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
        caret = draft.length;
        textareaEl.setSelectionRange(caret, caret);
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
    const context = buildSendContext({ mentions, attachments });
    if (queueMode === "steer") {
      // Interrupt + append: abort the running turn, then send the new prompt
      // immediately. Cleanup runs in the onAfterSend hook of submitMessage.
      onAbortTurn?.();
      // Defer the send to the next microtask so the abort can settle (the
      // store flips isGenerating asynchronously once the turn state clears).
      const prompt = content;
      const ctx = context;
      const snapshotMentions = mentions;
      const snapshotAttachments = attachments;
      draft = "";
      mentions = [];
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
            void snapshotMentions;
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
    mentions = [];
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
    slashState = { open: false, query: "" };
    mentionState = { open: false, query: "" };
    refreshQueue();
    return true;
  }

  async function submitOrEnqueue(): Promise<void> {
    if (tryEnqueueOrSteer()) {
      return;
    }
    const context = buildSendContext({ mentions, attachments });
    await submitMessage({
      ...(context ? { context } : {}),
      onAfterSend: (prompt) => {
        historyStore?.record(prompt);
        historyIndex = -1;
        mentions = [];
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
    // Slash popover navigation takes precedence when open.
    if (slashState.open && filteredCommands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        slashActiveIndex = (slashActiveIndex + 1) % filteredCommands.length;
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        slashActiveIndex =
          (slashActiveIndex - 1 + filteredCommands.length) % filteredCommands.length;
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const command = filteredCommands[slashActiveIndex];
        if (command) {
          applySlashCommand(command);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        slashState = { open: false, query: "" };
        return;
      }
    }
    // Mention picker navigation.
    if (mentionState.open && mentionTotalRows > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        mentionActiveIndex = (mentionActiveIndex + 1) % mentionTotalRows;
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        mentionActiveIndex =
          (mentionActiveIndex - 1 + mentionTotalRows) % mentionTotalRows;
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (mentionActiveIndex < mentionFiles.length) {
          const file = mentionFiles[mentionActiveIndex];
          if (file) {
            applyFileMention(file);
          }
        } else {
          const agent = filteredAgents[mentionActiveIndex - mentionFiles.length];
          if (agent) {
            applyAgentMention(agent);
          }
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        mentionState = { open: false, query: "" };
        return;
      }
    }
    // Prompt history: arrow-up at start of input cycles back; arrow-down
    // at end cycles forward. Only trigger when the caret is at the boundary.
    if (event.key === "ArrowUp" && !event.shiftKey) {
      if (caret === 0 && cycleHistoryUp()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      if (caret === draft.length && cycleHistoryDown()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitOrEnqueue();
    }
  }

  function formatTokenCount(value: number): string {
    return new Intl.NumberFormat("en-US", {
      notation: value >= 1000 ? "compact" : "standard",
      maximumFractionDigits: value >= 1000 ? 1 : 0,
    }).format(value);
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
  {#if isWorkspace}
    {#if queuedItems.length > 0}
      <div class="chat-queued-prompts" role="group" aria-label="Queued prompts">
        <div class="chat-queued-prompts-header">
          <span class="chat-queued-prompts-label">
            Queued ({queuedItems.length})
          </span>
          <div class="chat-queued-prompts-mode" role="group" aria-label="Queue mode">
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
    {#if mentions.length > 0}
      <ul class="chat-mentions-tray" role="group" aria-label="Mentions">
        {#each mentions as token (token.display)}
          <li class="chat-mention-chip">
            <span class="chat-mention-chip-text">{token.display}</span>
            <button
              type="button"
              class="chat-mention-chip-remove"
              aria-label={`Remove ${token.display}`}
              onclick={() => removeMention(token)}
            >
              ✕
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
  <div class="chat-input-wrap">
    <textarea
      class="chat-input"
      rows="3"
      bind:value={draft}
      bind:this={textareaEl}
      placeholder={composerPlaceholder}
      aria-label="Chat message"
      onkeydown={handleComposerKeydown}
      oninput={handleInput}
      onclick={updateCaret}
      onkeyup={updateCaret}
      disabled={composerDisabled}
    ></textarea>
    {#if isWorkspace && slashState.open}
      <div class="chat-composer-popover">
        <SlashCommandPopover
          commands={filteredCommands}
          activeIndex={slashActiveIndex}
          loading={commandCatalog.status === "loading"}
          errorMessage={commandCatalog.status === "error" ? commandCatalog.lastErrorMessage : null}
          onSelect={applySlashCommand}
          onHover={(index) => (slashActiveIndex = index)}
        />
      </div>
    {/if}
    {#if isWorkspace && mentionState.open}
      <div class="chat-composer-popover">
        <MentionPicker
          files={mentionFiles}
          agents={filteredAgents}
          activeIndex={mentionActiveIndex}
          loading={mentionFilesLoading}
          errorMessage={mentionFilesError}
          onSelectFile={applyFileMention}
          onSelectAgent={applyAgentMention}
          onHover={(index) => (mentionActiveIndex = index)}
        />
      </div>
    {/if}
  </div>
  <div class="chat-composer-actions">
    <div class="chat-composer-toolbar">
      {#if isWorkspace}
        <WorkspaceCatalogPicker
          catalog={opencodeCatalog}
          activeAgentId={activeOpencodeAgentId}
          activeProviderId={activeOpencodeProviderId}
          activeModelId={activeModel}
          disabled={isModelSelectionDisabled}
          onSelectAgent={selectOpencodeAgent}
          onSelectProvider={selectOpencodeProvider}
          onSelectModel={(value) => void selectModel(value)}
        />
      {:else}
        <ChatModePicker
          {availableModes}
          {activeMode}
          disabled={isModeSelectionDisabled}
          onSelectMode={selectMode}
        />
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
      {/if}
    </div>
    <div class="chat-composer-controls">
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
      <span
        class={`chat-context-budget ${budgetStateClass}`.trim()}
        role="status"
        aria-live="polite"
        title="Estimated input tokens (system prompt + retained history + draft)"
      >
        {budgetDisplayText}
      </span>
      <button
        type="button"
        class="chat-send-button"
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
