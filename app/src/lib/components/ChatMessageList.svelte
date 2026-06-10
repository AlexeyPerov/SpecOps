<script lang="ts">
  import {
    formatModelSwitchNotice,
    formatProviderSwitchNotice,
  } from "../ai/providers/selection";
  import {
    parseStructuredMessageSections,
    type StructuredMessageSection,
  } from "../ai/chatReviewContent";
  import type { ChatMessage } from "../domain/contracts";
  import ToolCard from "./ToolCard.svelte";

  interface Props {
    messages: ChatMessage[];
    isEmpty: boolean;
    isGenerating: boolean;
    activeModeRequiredSections?: readonly string[];
    compactionNotice?: string;
    emptyHint?: string;
  }

  let {
    messages,
    isEmpty,
    isGenerating,
    activeModeRequiredSections = [],
    compactionNotice = "",
    emptyHint = "Ask or review ideas for this workspace. Pick a provider and mode, then send a message.",
  }: Props = $props();

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
      <ol class="chat-message-list" aria-label="Conversation">
        {#each messages as message, index (message.id)}
          <li
            class={`chat-message chat-message-${message.role}`}
            class:chat-message-system-event={isSystemEventMessage(message)}
            class:chat-message-streaming={isStreamingAssistantMessage(message, index)}
          >
            <p class="chat-message-role">{messageRoleLabel(message)}</p>
            {#if shouldRenderStructuredSections(message, index)}
              <div class="chat-review-sections">
                {#each structuredSectionsForMessage(message) ?? [] as section (section.heading)}
                  <section class="chat-review-section">
                    <h3 class="chat-review-section-heading">{section.heading}</h3>
                    <p class="chat-review-section-body">{section.body}</p>
                  </section>
                {/each}
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

  .chat-message-content {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
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
</style>
