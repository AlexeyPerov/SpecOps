<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    formatModelSwitchNotice,
    formatProviderSwitchNotice,
  } from "../ai/providers/selection";
  import {
    parseStructuredMessageSections,
    type StructuredMessageSection,
  } from "../ai/chatReviewContent";
  import {
    buildMessageRenderSlots,
    type MessageRenderSlot,
  } from "../ai/chatMessageLayout";
  import {
    extractMessageStepTotals,
    type MessageStepTotals,
  } from "../ai/chatSteps";
  import { cacheTotal, formatCost, formatTokenCount } from "../ai/chatTokenFormat";
  import type { ChatMessage } from "../domain/contracts";
  import EmptyState from "./EmptyState.svelte";
  import ToolCard from "./ToolCard.svelte";
  import ReasoningBlock from "./ReasoningBlock.svelte";
  import SubtaskCard from "./SubtaskCard.svelte";
  import StepSeparator from "./StepSeparator.svelte";
  import ImageAttachment from "./ImageAttachment.svelte";
  import FileAttachmentChip from "./FileAttachmentChip.svelte";
  import InlineDiff from "./InlineDiff.svelte";
  import MarkdownRenderer from "./MarkdownRenderer.svelte";
  import SessionSummary from "./SessionSummary.svelte";

  // Module-level scroll cache: remembers the last scroll position per session
  // so re-entering a chat tab (which remounts this component) restores scroll
  // instead of jumping to the top. The map grows with the number of distinct
  // sessions visited; entries are overwritten on revisit and never exceed the
  // number of sessions the user has opened in this window's lifetime.
  const chatScrollBySessionId = new Map<string, number>();

  interface Props {
    messages: ChatMessage[];
    isEmpty: boolean;
    isGenerating: boolean;
    /** Active session id, used to key the scroll-restore cache. */
    sessionId?: string | null;
    activeModeRequiredSections?: readonly string[];
    compactionNotice?: string;
    emptyHint?: string;
    emptyActionLabel?: string;
    onEmptyAction?: () => void;
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
    sessionId = null,
    activeModeRequiredSections = [],
    compactionNotice = "",
    emptyHint = "Send a message to start.",
    emptyActionLabel,
    onEmptyAction,
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
   * M5-T5 — scroll container ref. Listens for the `specops:scroll-to-message`
   * custom event (dispatched by the session timeline dialog) and scrolls the
   * matching message into view.
   */
  let scrollContainerEl = $state<HTMLDivElement | null>(null);

  function handleScrollToMessage(event: Event): void {
    const detail = (event as CustomEvent<{ messageId?: string }>).detail;
    const messageId = detail?.messageId;
    if (!messageId || !scrollContainerEl) {
      return;
    }
    const target = scrollContainerEl.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  let scrollPersistTimer: ReturnType<typeof setTimeout> | null = null;

  function handleScrollCapture(): void {
    if (!scrollContainerEl || !sessionId) {
      return;
    }
    // Debounce writes so rapid scroll events don't thrash the map.
    if (scrollPersistTimer) {
      clearTimeout(scrollPersistTimer);
    }
    const captured = sessionId;
    const top = scrollContainerEl.scrollTop;
    scrollPersistTimer = setTimeout(() => {
      chatScrollBySessionId.set(captured, top);
    }, 120);
  }

  onMount(() => {
    window.addEventListener("specops:scroll-to-message", handleScrollToMessage);
    // Restore the last-known scroll position for this session, if any. Runs
    // after the DOM is painted so the scroll target height is correct. When a
    // fresh turn is actively generating, the list auto-scrolls to the bottom
    // anyway (see the generation-tracking effect below), which takes precedence.
    if (sessionId && scrollContainerEl) {
      const saved = chatScrollBySessionId.get(sessionId);
      if (saved !== undefined) {
        const el = scrollContainerEl;
        requestAnimationFrame(() => {
          el.scrollTop = saved;
        });
      }
    }
  });

  onDestroy(() => {
    window.removeEventListener("specops:scroll-to-message", handleScrollToMessage);
    if (scrollPersistTimer) {
      clearTimeout(scrollPersistTimer);
      scrollPersistTimer = null;
    }
  });

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

  /**
   * M12-T1 — interleaved part rendering. Instead of pulling each part kind out
   * via per-type extractors and rendering them in a fixed block order, we walk
   * `message.parts` once (via `buildMessageRenderSlots`) and render each part
   * at its stored position. Tool cards and the totals footer stay outside the
   * slot loop — they are not parts.
   *
   * Only assistant messages carry reasoning/subtask/step/diff parts on the
   * wire, so we skip the slot loop for user/system messages entirely (those
   * render `message.content` plus any file attachments — user file parts would
   * be included by the slot builder, but user messages reach this component
   * with content-only, no `parts`, so the loop is naturally empty for them).
   */
  function slotsFor(message: ChatMessage): MessageRenderSlot[] {
    if (message.role !== "assistant") {
      return [];
    }
    return buildMessageRenderSlots(message);
  }

  function isReasoningExpanded(reasoningId: string): boolean {
    return showAllReasoning || Boolean(expandedReasoning[reasoningId]);
  }

  function toggleReasoning(reasoningId: string): void {
    // When the global toggle is on, flipping a per-message control implicitly
    // opts that message out by recording an explicit false.
    expandedReasoning = {
      ...expandedReasoning,
      [reasoningId]: !isReasoningExpanded(reasoningId),
    };
  }

  function toggleAllReasoning(): void {
    showAllReasoning = !showAllReasoning;
  }

  /** True when at least one visible message carries a reasoning slot. */
  let hasAnyReasoning = $derived(
    messages.some((message) =>
      slotsFor(message).some((slot) => slot.kind === "reasoning"),
    ),
  );

  /**
   * Per-subtask expanded state, keyed by subtask id. Unlike reasoning there is
   * no global toggle — subtasks are independent and collapse on their own.
   */
  let expandedSubtasks = $state<Record<string, boolean>>({});

  function isSubtaskExpanded(subtaskId: string): boolean {
    return Boolean(expandedSubtasks[subtaskId]);
  }

  function toggleSubtask(subtaskId: string): void {
    expandedSubtasks = {
      ...expandedSubtasks,
      [subtaskId]: !isSubtaskExpanded(subtaskId),
    };
  }

  /** Cumulative cost / token totals for the message footer; null when none. */
  function stepTotalsFor(message: ChatMessage): MessageStepTotals | null {
    if (message.role !== "assistant") {
      return null;
    }
    return extractMessageStepTotals(message);
  }

  /**
   * Per-diff expanded state, keyed by diff id. Like subtasks there is no global
   * toggle — each diff collapses on its own.
   */
  let expandedDiffs = $state<Record<string, boolean>>({});

  function isDiffExpanded(diffId: string): boolean {
    return Boolean(expandedDiffs[diffId]);
  }

  function toggleDiff(diffId: string): void {
    expandedDiffs = {
      ...expandedDiffs,
      [diffId]: !isDiffExpanded(diffId),
    };
  }

  /**
   * Whether the message has any `text` slot in its parts. When false (the
   * live-streaming case, where text lives on `message.content` rather than in
   * `parts[]`, or messages with no parts at all) we render `message.content`
   * as a single content block instead of per-text-part.
   */
  function messageHasTextSlots(message: ChatMessage): boolean {
    return slotsFor(message).some((slot) => slot.kind === "text");
  }

  /**
   * The key of the first `text` slot, used to anchor the structured-review
   * sections block in place of the first text segment (so non-text parts keep
   * their positions around it). Returns an empty string when there are no text
   * slots, in which case the structured sections render via the content
   * fallback path instead.
   */
  function firstTextSlotKey(message: ChatMessage): string {
    for (const slot of slotsFor(message)) {
      if (slot.kind === "text") {
        return slot.key;
      }
    }
    return "";
  }

  /**
   * Whether a single text segment should render as markdown prose. Mirrors the
   * whole-message decision: assistant non-streaming text that isn't part of a
   * structured-review section renders as markdown. Applied per text slot so
   * interleaved text segments each get markdown treatment once streaming ends.
   */
  function shouldRenderTextSlotAsMarkdown(message: ChatMessage, index: number): boolean {
    return shouldRenderMarkdown(message, index);
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

  /**
   * Small per-message date+time label rendered at the bottom-right of every
   * bubble. Same-day messages show `HH:MM`; older messages also show the date
   * (`MM/DD HH:MM`, with year added when it differs from the current year).
   * Returns an empty string for invalid/missing timestamps.
   */
  function formatMessageTimestamp(value: string | undefined): string {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    const sameDay =
      sameYear &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    const time = date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    if (sameDay) {
      return time;
    }
    const datePart = sameYear
      ? date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
      : date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "numeric",
          day: "numeric",
        });
    return `${datePart} ${time}`;
  }

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
    <EmptyState
      class="chat-empty"
      variant="inline"
      title="Start chat"
      description={emptyHint}
    >
      {#if emptyActionLabel && onEmptyAction}
        {#snippet actions()}
          <button type="button" class="btn btn-primary chat-setup-button" onclick={onEmptyAction}>
            {emptyActionLabel}
          </button>
        {/snippet}
      {/if}
    </EmptyState>
  {:else}
    <div class="chat-message-scroll" bind:this={scrollContainerEl} onscroll={handleScrollCapture}>
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
          {@const slots = slotsFor(message)}
          {@const stepTotals = stepTotalsFor(message)}
          {@const hasTextSlots = messageHasTextSlots(message)}
          <li
            class={`chat-message chat-message-${message.role}`}
            class:chat-message-system-event={isSystemEventMessage(message)}
            class:chat-message-streaming={isStreamingAssistantMessage(message, index)}
            data-message-id={message.id}
          >
            <div class="chat-message-header">
              <p class="chat-message-role">{messageRoleLabel(message)}</p>
              {#if hasMessageActions(message, index)}
                <div class="chat-message-actions">
                  {#if canForkFromMessage}
                    <button
                      type="button"
                      class="chat-message-action"
                      title="Fork this session into a new session tab from this message"
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
            <div class="chat-message-body">
              {#if slots.length > 0}
                {#each slots as slot (slot.key)}
                  {#if slot.kind === "step-boundary"}
                    <StepSeparator boundary={slot.boundary} />
                  {:else if slot.kind === "reasoning"}
                    <ReasoningBlock
                      reasoning={{ id: slot.id, text: slot.text }}
                      expanded={isReasoningExpanded(slot.id)}
                      streaming={isStreamingAssistantMessage(message, index)}
                      onToggle={() => toggleReasoning(slot.id)}
                    />
                  {:else if slot.kind === "subtask"}
                    <SubtaskCard
                      subtask={slot.subtask}
                      expanded={isSubtaskExpanded(slot.subtask.id)}
                      onToggle={() => toggleSubtask(slot.subtask.id)}
                    />
                  {:else if slot.kind === "text"}
                    {#if shouldRenderStructuredSections(message, index)}
                      <!--
                        Structured-review sections are a whole-message override that
                        parses `message.content` as a single document. Render them in
                        place of the first text slot (the others render nothing) so
                        non-text parts (reasoning before the review, etc.) keep their
                        positions and the review prose lands where the text lives.
                      -->
                      {#if slot.key === firstTextSlotKey(message)}
                        <div class="chat-review-sections">
                          {#each structuredSectionsForMessage(message) ?? [] as section (section.heading)}
                            <section class="chat-review-section">
                              <h3 class="chat-review-section-heading">{section.heading}</h3>
                              <p class="chat-review-section-body">{section.body}</p>
                            </section>
                          {/each}
                        </div>
                      {/if}
                    {:else if shouldRenderTextSlotAsMarkdown(message, index)}
                      <div class="chat-message-content chat-message-content-prose">
                        <MarkdownRenderer source={slot.text} />
                      </div>
                    {:else}
                      <p class="chat-message-content">{slot.text}</p>
                    {/if}
                  {:else if slot.kind === "file-image"}
                    <div class="chat-message-attachments chat-message-attachments-images">
                      <ImageAttachment attachment={slot.attachment} />
                    </div>
                  {:else if slot.kind === "file-other"}
                    <div class="chat-message-attachments chat-message-attachments-files">
                      <FileAttachmentChip attachment={slot.attachment} />
                    </div>
                  {:else if slot.kind === "diff"}
                    <InlineDiff
                      diff={slot.diff}
                      expanded={isDiffExpanded(slot.diff.id)}
                      onToggle={() => toggleDiff(slot.diff.id)}
                    />
                  {/if}
                {/each}
              {/if}
              {#if !hasTextSlots}
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
              {/if}
              {#if hasToolCards(message)}
                <div class="chat-tool-cards">
                  {#each message.toolCalls ?? [] as toolCall (toolCall.callId)}
                    <ToolCard {toolCall} />
                  {/each}
                </div>
              {/if}
            </div>
            <time
              class="chat-message-timestamp"
              datetime={message.createdAt}
              title={message.createdAt}
            >
              {formatMessageTimestamp(message.createdAt)}
            </time>
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

  /*
   * M2-2 — chat empty uses the shared EmptyState primitive. The panel body
   * is a flex column justified to flex-end so the empty block sits at the
   * bottom of the panel (matching the previous inline placement). We only
   * constrain alignment/spacing here; typography comes from EmptyState.
   */
  .chat-empty {
    align-items: flex-start;
    text-align: left;
    padding: 0;
    gap: var(--space-2);
  }

  :global(.chat-empty .chat-setup-button) {
    align-self: flex-start;
    min-height: 26px;
    margin-top: var(--space-2);
    padding: 0 var(--space-8);
    font-size: var(--font-size-md);
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
    font-size: var(--font-size-sm);
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-compaction-notice-body {
    margin: 0;
    font-size: var(--font-size-md);
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
    font-size: var(--font-size-sm);
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
    position: relative;
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    background: var(--color-surface-1);
  }

  .chat-message-timestamp {
    position: absolute;
    right: var(--space-3);
    bottom: var(--space-2);
    font-size: var(--font-size-xs);
    line-height: 1.4;
    color: var(--color-text-secondary);
    opacity: 0.65;
    pointer-events: auto;
    font-variant-numeric: tabular-nums;
  }

  /* Hide the timestamp label when it has no value (invalid/missing createdAt). */
  .chat-message-timestamp:empty {
    display: none;
  }

  .chat-message-user {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }

  .chat-message-assistant {
    background: transparent;
    padding-left: 0;
    padding-right: 0;
  }

  .chat-message-system {
    border: 1px dashed color-mix(in srgb, var(--color-text-secondary) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-text-secondary) 8%, var(--color-surface-1));
  }

  .chat-message-system-event {
    border-color: color-mix(in srgb, var(--color-accent) 35%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }

  .chat-message-role {
    margin: 0 0 var(--space-2) 0;
    font-size: var(--font-size-sm);
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
    font-size: var(--font-size-xs);
    line-height: 1.4;
    cursor: pointer;
  }

  .chat-message-action:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
    background: var(--color-hover);
  }

  .chat-message-action-danger:hover {
    color: var(--color-error);
    border-color: color-mix(in srgb, var(--color-error) 55%, var(--color-border-subtle));
  }

  .chat-message-content {
    margin: 0;
    font-size: var(--font-size-md);
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
    font-size: var(--font-size-sm);
    line-height: 1.4;
    font-weight: 600;
    color: var(--color-text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .chat-review-section-body {
    margin: 0;
    font-size: var(--font-size-md);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    color: var(--color-text-secondary);
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

  /*
   * M12-T1 — the message body is a single flex column holding the interleaved
   * part slots (steps / reasoning / subtasks / text / attachments / diffs), the
   * content fallback, and the tool cards, in stored order. The gap spaces every
   * part uniformly; the previous per-block `margin-top` / adjacency rules
   * (`chat-step-separators` / `chat-subtask-cards` / `chat-inline-diffs`) are no
   * longer needed because nothing is grouped into a type-block wrapper.
   */
  .chat-message-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .chat-tool-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .chat-message-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .chat-message-attachments-images {
    flex-direction: row;
    align-items: flex-start;
  }

  .chat-message-attachments-files {
    flex-direction: row;
    align-items: center;
  }

  .chat-message-totals {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px dashed var(--color-border-subtle);
    font-size: var(--font-size-xs);
    line-height: 1.4;
    color: var(--color-text-secondary);
    /* Leave room for the absolutely-positioned bottom-right timestamp label. */
    padding-right: calc(var(--space-3) + 7ch);
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
