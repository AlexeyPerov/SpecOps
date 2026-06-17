<script lang="ts">
  import {
    formatModelSwitchNotice,
    formatProviderSwitchNotice,
  } from "../ai/providers/selection";
  import {
    parseStructuredMessageSections,
    type StructuredMessageSection,
  } from "../ai/chatReviewContent";
  import { extractMessageReasoning, type MessageReasoning } from "../ai/chatReasoning";
  import { extractMessageSubtasks, type MessageSubtask } from "../ai/chatSubtasks";
  import {
    extractMessageSteps,
    extractMessageStepTotals,
    type MessageStepBoundary,
    type MessageStepTotals,
  } from "../ai/chatSteps";
  import {
    extractMessageAttachments,
    type MessageAttachment,
  } from "../ai/chatAttachments";
  import {
    extractMessageDiffs,
    type MessageDiff,
  } from "../ai/chatDiffs";
  import { cacheTotal, formatCost, formatTokenCount } from "../ai/chatTokenFormat";
  import type { ChatMessage } from "../domain/contracts";
  import ToolCard from "./ToolCard.svelte";
  import ReasoningBlock from "./ReasoningBlock.svelte";
  import SubtaskCard from "./SubtaskCard.svelte";
  import StepSeparator from "./StepSeparator.svelte";
  import ImageAttachment from "./ImageAttachment.svelte";
  import FileAttachmentChip from "./FileAttachmentChip.svelte";
  import InlineDiff from "./InlineDiff.svelte";
  import MarkdownRenderer from "./MarkdownRenderer.svelte";
  import SessionSummary from "./SessionSummary.svelte";

  interface Props {
    messages: ChatMessage[];
    isEmpty: boolean;
    isGenerating: boolean;
    activeModeRequiredSections?: readonly string[];
    compactionNotice?: string;
    emptyHint?: string;
    /** M2-T6: agent-generated session summary, shown as a collapsible banner. */
    sessionSummary?: string;
    /** M2-T3: enables per-message "Fork from here" action. */
    canForkFromMessage?: boolean;
    /** M2-T4: enables per-message "Undo to here" action. */
    canRevertFromMessage?: boolean;
    onForkFromMessage?: (messageId: string) => void;
    onRevertFromMessage?: (messageId: string) => void;
  }

  let {
    messages,
    isEmpty,
    isGenerating,
    activeModeRequiredSections = [],
    compactionNotice = "",
    emptyHint = "Send a message to start.",
    sessionSummary = "",
    canForkFromMessage = false,
    canRevertFromMessage = false,
    onForkFromMessage = () => {},
    onRevertFromMessage = () => {},
  }: Props = $props();

  /**
   * Global show/hide-all-reasoning toggle. When true, every reasoning block is
   * expanded; when false, each message falls back to its own per-message state.
   * Default: collapsed — reasoning is available on demand, not by default.
   */
  let showAllReasoning = $state(false);

  /**
   * Per-message expanded state, keyed by reasoning id. A message is expanded
   * when the global toggle is on OR its entry here is true.
   */
  let expandedReasoning = $state<Record<string, boolean>>({});

  function isProviderSwitchMessage(message: ChatMessage): boolean {
    return message.systemEvent?.type === "provider-switched";
  }

  function isModelSwitchMessage(message: ChatMessage): boolean {
    return message.systemEvent?.type === "model-switched";
  }

  function isSystemEventMessage(message: ChatMessage): boolean {
    return isProviderSwitchMessage(message) || isModelSwitchMessage(message);
  }

  function messageDisplayContent(message: ChatMessage): string {
    if (message.systemEvent?.type === "provider-switched") {
      return formatProviderSwitchNotice(message.systemEvent);
    }
    if (message.systemEvent?.type === "model-switched") {
      return formatModelSwitchNotice(message.systemEvent);
    }
    return message.content;
  }

  function structuredSectionsForMessage(message: ChatMessage): StructuredMessageSection[] | null {
    if (message.role !== "assistant" || activeModeRequiredSections.length === 0) {
      return null;
    }
    return parseStructuredMessageSections(message.content, activeModeRequiredSections);
  }

  function isStreamingAssistantMessage(message: ChatMessage, index: number): boolean {
    return isGenerating && message.role === "assistant" && index === messages.length - 1;
  }

  function shouldRenderStructuredSections(message: ChatMessage, index: number): boolean {
    // Keep streaming output in plain text until generation completes to avoid
    // section layout churn while partial markdown headings arrive.
    return !isStreamingAssistantMessage(message, index) && Boolean(structuredSectionsForMessage(message));
  }

  /**
   * Whether the message body should render as markdown prose rather than plain
   * text. Assistant messages get full markdown rendering once they stop
   * streaming; user messages stay verbatim so the user always sees exactly
   * what they typed. System notices and structured-review sections bypass this
   * path entirely.
   */
  function shouldRenderMarkdown(message: ChatMessage, index: number): boolean {
    if (message.role !== "assistant") return false;
    if (isStreamingAssistantMessage(message, index)) return false;
    if (shouldRenderStructuredSections(message, index)) return false;
    return message.content.trim().length > 0;
  }

  function reasoningFor(message: ChatMessage, index: number): MessageReasoning | null {
    if (message.role !== "assistant") {
      return null;
    }
    return extractMessageReasoning(message);
  }

  function isReasoningExpanded(reasoning: MessageReasoning): boolean {
    return showAllReasoning || Boolean(expandedReasoning[reasoning.id]);
  }

  function toggleReasoning(reasoning: MessageReasoning): void {
    // When the global toggle is on, flipping a per-message control implicitly
    // opts that message out by recording an explicit false.
    expandedReasoning = {
      ...expandedReasoning,
      [reasoning.id]: !isReasoningExpanded(reasoning),
    };
  }

  function toggleAllReasoning(): void {
    showAllReasoning = !showAllReasoning;
  }

  /** True when at least one visible message carries reasoning. */
  let hasAnyReasoning = $derived(
    messages.some((message, index) => reasoningFor(message, index) !== null),
  );

  /**
   * Per-subtask expanded state, keyed by subtask id. Unlike reasoning there is
   * no global toggle — subtasks are independent and collapse on their own.
   */
  let expandedSubtasks = $state<Record<string, boolean>>({});

  function subtasksFor(message: ChatMessage): MessageSubtask[] {
    if (message.role !== "assistant") {
      return [];
    }
    return extractMessageSubtasks(message);
  }

  function isSubtaskExpanded(subtask: MessageSubtask): boolean {
    return Boolean(expandedSubtasks[subtask.id]);
  }

  function toggleSubtask(subtask: MessageSubtask): void {
    expandedSubtasks = {
      ...expandedSubtasks,
      [subtask.id]: !isSubtaskExpanded(subtask),
    };
  }

  /**
   * Step boundaries for a message. Like subtasks, role filtering is the
   * component's concern (extractor itself is role-agnostic) — only assistant
   * messages carry agentic step parts.
   */
  function stepsFor(message: ChatMessage): MessageStepBoundary[] {
    if (message.role !== "assistant") {
      return [];
    }
    return extractMessageSteps(message);
  }

  /** Cumulative cost / token totals for the message footer; null when none. */
  function stepTotalsFor(message: ChatMessage): MessageStepTotals | null {
    if (message.role !== "assistant") {
      return null;
    }
    return extractMessageStepTotals(message);
  }

  /**
   * File attachments for a message, split into inline images and downloadable
   * file chips. Unlike reasoning/subtask/step (assistant-only), file parts
   * also arrive on user messages (pasted / uploaded attachments), so we do
   * not gate on role here.
   */
  function attachmentsFor(message: ChatMessage): {
    images: MessageAttachment[];
    files: MessageAttachment[];
  } {
    return extractMessageAttachments(message);
  }

  /**
   * Diff / snapshot parts for a message. Like subtasks/steps, only assistant
   * messages carry agentic snapshot/patch parts, so we gate on role here (the
   * extractor itself is role-agnostic).
   */
  function diffsFor(message: ChatMessage): MessageDiff[] {
    if (message.role !== "assistant") {
      return [];
    }
    return extractMessageDiffs(message);
  }

  /**
   * Per-diff expanded state, keyed by diff id. Like subtasks there is no global
   * toggle — each diff collapses on its own.
   */
  let expandedDiffs = $state<Record<string, boolean>>({});

  function isDiffExpanded(diff: MessageDiff): boolean {
    return Boolean(expandedDiffs[diff.id]);
  }

  function toggleDiff(diff: MessageDiff): void {
    expandedDiffs = {
      ...expandedDiffs,
      [diff.id]: !isDiffExpanded(diff),
    };
  }

  /**
   * Whether the per-message action toolbar should render. Only for messages
   * that aren't mid-stream and only when at least one action is wired. The
   * toolbar is hidden entirely for chat-http / debug contexts (those pass
   * `canForkFromMessage` / `canRevertFromMessage` as false).
   */
  function hasMessageActions(message: ChatMessage, index: number): boolean {
    if (isStreamingAssistantMessage(message, index)) {
      return false;
    }
    return canForkFromMessage || canRevertFromMessage;
  }

  /** Compact token-count formatting for the running-total footer. */
  function messageRoleLabel(message: ChatMessage): string {
    if (isProviderSwitchMessage(message)) {
      return "Provider switch";
    }
    if (isModelSwitchMessage(message)) {
      return "Model switch";
    }
    if (message.role === "assistant") {
      return "Assistant";
    }
    if (message.role === "system") {
      return "System";
    }
    return "You";
  }

  function hasToolCards(message: ChatMessage): boolean {
    return Boolean(message.toolCalls && message.toolCalls.length > 0);
  }
</script>

{#if sessionSummary}
  <SessionSummary summary={sessionSummary} />
{/if}

{#if compactionNotice}
  <div class="chat-compaction-notice" role="status">
    <p class="chat-compaction-notice-title">Chat history compacted</p>
    <p class="chat-compaction-notice-body">{compactionNotice}</p>
  </div>
{/if}

<div class="chat-panel-body">
  {#if isEmpty}
    <div class="chat-empty-state">
      <p class="chat-title">Start chat</p>
      <p class="chat-hint">
        {emptyHint}
      </p>
    </div>
  {:else}
    <div class="chat-message-scroll">
      {#if hasAnyReasoning}
        <div class="chat-reasoning-toolbar">
          <button
            type="button"
            class="chat-reasoning-toggle"
            onclick={toggleAllReasoning}
            aria-pressed={showAllReasoning}
          >
            {showAllReasoning ? "Hide all reasoning" : "Show all reasoning"}
          </button>
        </div>
      {/if}
      <ol class="chat-message-list" aria-label="Conversation">
        {#each messages as message, index (message.id)}
          {@const reasoningBlock = reasoningFor(message, index)}
          {@const subtasks = subtasksFor(message)}
          {@const steps = stepsFor(message)}
          {@const stepTotals = stepTotalsFor(message)}
          {@const attachments = attachmentsFor(message)}
          {@const diffs = diffsFor(message)}
          <li
            class={`chat-message chat-message-${message.role}`}
            class:chat-message-system-event={isSystemEventMessage(message)}
            class:chat-message-streaming={isStreamingAssistantMessage(message, index)}
          >
            <div class="chat-message-header">
              <p class="chat-message-role">{messageRoleLabel(message)}</p>
              {#if hasMessageActions(message, index)}
                <div class="chat-message-actions">
                  {#if canForkFromMessage}
                    <button
                      type="button"
                      class="chat-message-action"
                      title="Fork this session into a new agent tab from this message"
                      onclick={() => onForkFromMessage(message.id)}
                    >
                      Fork
                    </button>
                  {/if}
                  {#if canRevertFromMessage}
                    <button
                      type="button"
                      class="chat-message-action chat-message-action-danger"
                      title="Undo this session back to this message"
                      onclick={() => onRevertFromMessage(message.id)}
                    >
                      Undo
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
            {#if steps.length > 0}
              <div class="chat-step-separators">
                {#each steps as boundary (boundary.id)}
                  <StepSeparator {boundary} />
                {/each}
              </div>
            {/if}
            {#if reasoningBlock}
              <ReasoningBlock
                reasoning={reasoningBlock}
                expanded={isReasoningExpanded(reasoningBlock)}
                streaming={isStreamingAssistantMessage(message, index)}
                onToggle={() => toggleReasoning(reasoningBlock)}
              />
            {/if}
            {#if subtasks.length > 0}
              <div class="chat-subtask-cards">
                {#each subtasks as subtask (subtask.id)}
                  <SubtaskCard
                    {subtask}
                    expanded={isSubtaskExpanded(subtask)}
                    onToggle={() => toggleSubtask(subtask)}
                  />
                {/each}
              </div>
            {/if}
            {#if shouldRenderStructuredSections(message, index)}
              <div class="chat-review-sections">
                {#each structuredSectionsForMessage(message) ?? [] as section (section.heading)}
                  <section class="chat-review-section">
                    <h3 class="chat-review-section-heading">{section.heading}</h3>
                    <p class="chat-review-section-body">{section.body}</p>
                  </section>
                {/each}
              </div>
            {:else if shouldRenderMarkdown(message, index)}
              <div class="chat-message-content chat-message-content-prose">
                <MarkdownRenderer source={message.content} />
              </div>
            {:else}
              <p class="chat-message-content">
                {#if message.role === "assistant" && message.content.length === 0 && isStreamingAssistantMessage(message, index)}
                  <span class="chat-streaming-placeholder">Generating…</span>
                {:else}
                  {messageDisplayContent(message)}
                  {#if isStreamingAssistantMessage(message, index)}
                    <span class="chat-streaming-cursor" aria-hidden="true"></span>
                  {/if}
                {/if}
              </p>
            {/if}
            {#if hasToolCards(message)}
              <div class="chat-tool-cards">
                {#each message.toolCalls ?? [] as toolCall (toolCall.callId)}
                  <ToolCard {toolCall} />
                {/each}
              </div>
            {/if}
            {#if attachments.images.length > 0}
              <div class="chat-attachments chat-attachments-images">
                {#each attachments.images as image (image.id)}
                  <ImageAttachment attachment={image} />
                {/each}
              </div>
            {/if}
            {#if attachments.files.length > 0}
              <div class="chat-attachments chat-attachments-files">
                {#each attachments.files as file (file.id)}
                  <FileAttachmentChip attachment={file} />
                {/each}
              </div>
            {/if}
            {#if diffs.length > 0}
              <div class="chat-inline-diffs">
                {#each diffs as diff (diff.id)}
                  <InlineDiff
                    {diff}
                    expanded={isDiffExpanded(diff)}
                    onToggle={() => toggleDiff(diff)}
                  />
                {/each}
              </div>
            {/if}
            {#if stepTotals}
              <footer class="chat-message-totals">
                <span class="chat-message-totals-tokens">
                  <span class="chat-message-totals-field">
                    <span class="chat-message-totals-key">in</span>{formatTokenCount(stepTotals.tokens.input)}
                  </span>
                  <span class="chat-message-totals-field">
                    <span class="chat-message-totals-key">out</span>{formatTokenCount(stepTotals.tokens.output)}
                  </span>
                  <span class="chat-message-totals-field">
                    <span class="chat-message-totals-key">cache</span>{formatTokenCount(cacheTotal(stepTotals.tokens))}
                  </span>
                </span>
                <span class="chat-message-totals-cost">{formatCost(stepTotals.cost)}</span>
              </footer>
            {/if}
          </li>
        {/each}
      </ol>
    </div>
  {/if}
</div>

<style>
  .chat-panel-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .chat-message-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .chat-empty-state {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-text-secondary);
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

  .chat-message-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .chat-reasoning-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: calc(var(--space-6) * -1);
  }

  .chat-reasoning-toggle {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    padding: var(--space-2) var(--space-4);
    font-size: 11px;
    line-height: 1.4;
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard);
  }

  .chat-reasoning-toggle:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 8%, transparent);
    color: var(--color-text-primary);
  }

  .chat-reasoning-toggle[aria-pressed="true"] {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle));
    color: var(--color-text-primary);
  }

  .chat-message {
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    background: var(--color-surface-1);
  }

  .chat-message:not(.chat-message-assistant) {
    border: 1px solid var(--color-border-subtle);
  }

  .chat-message-user {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }

  .chat-message-assistant {
    background: transparent;
    padding-left: 0;
    padding-right: 0;
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

  .chat-message-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-2);
  }

  .chat-message-header .chat-message-role {
    margin: 0;
  }

  .chat-message-actions {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--easing-standard);
  }

  /* Actions are discoverable on hover but stay keyboard-accessible always. */
  .chat-message:hover .chat-message-actions,
  .chat-message-actions:focus-within {
    opacity: 1;
  }

  .chat-message-action {
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 10px;
    line-height: 1.4;
    cursor: pointer;
  }

  .chat-message-action:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
    background: var(--color-hover);
  }

  .chat-message-action-danger:hover {
    color: #e06c75;
    border-color: color-mix(in srgb, #e06c75 55%, var(--color-border-subtle));
  }

  .chat-message-content {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  /* Markdown prose container — `white-space` must be normal so block elements
     inside collapse whitespace the way marked/DOMPurify produced them. */
  .chat-message-content-prose {
    white-space: normal;
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

  .chat-message-streaming:not(.chat-message-assistant) {
    border-style: dashed;
  }

  .chat-message-streaming .chat-message-content {
    color: color-mix(in srgb, var(--color-text-primary) 94%, var(--color-text-secondary));
  }

  .chat-streaming-placeholder {
    color: var(--color-text-secondary);
    font-style: italic;
  }

  .chat-streaming-cursor {
    display: inline-block;
    width: 0.55ch;
    height: 1em;
    margin-left: 0.08em;
    vertical-align: -0.1em;
    background: color-mix(in srgb, var(--color-text-primary) 80%, var(--color-text-secondary));
    opacity: 0.9;
    animation: chat-streaming-cursor-blink 1.15s steps(1, end) infinite;
  }

  @keyframes chat-streaming-cursor-blink {
    0%,
    49% {
      opacity: 0.9;
    }
    50%,
    100% {
      opacity: 0;
    }
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

  .chat-tool-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .chat-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  .chat-attachments-images {
    flex-direction: row;
    align-items: flex-start;
  }

  .chat-attachments-files {
    flex-direction: row;
    align-items: center;
  }

  /* When attachments follow tool cards or other attachments, keep a single gap. */
  .chat-tool-cards + .chat-attachments,
  .chat-attachments + .chat-attachments {
    margin-top: var(--space-3);
  }

  .chat-subtask-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  /* When subtask cards precede tool cards, collapse the double gap. */
  .chat-subtask-cards + .chat-tool-cards {
    margin-top: var(--space-3);
  }

  .chat-inline-diffs {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-4);
  }

  /* When inline diffs follow tool cards or attachments, keep a single gap. */
  .chat-tool-cards + .chat-inline-diffs,
  .chat-attachments + .chat-inline-diffs,
  .chat-inline-diffs + .chat-inline-diffs {
    margin-top: var(--space-3);
  }

  .chat-step-separators {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .chat-message-totals {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px dashed var(--color-border-subtle);
    font-size: 10px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  .chat-message-totals-tokens {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-3);
    font-family: monospace;
  }

  .chat-message-totals-field {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
  }

  .chat-message-totals-key {
    font-size: 9px;
    opacity: 0.7;
  }

  .chat-message-totals-cost {
    font-family: monospace;
    opacity: 0.85;
  }
</style>
