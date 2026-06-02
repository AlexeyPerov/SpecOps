<script lang="ts">
  import {
    formatModelSwitchNotice,
    formatProviderSwitchNotice,
  } from "../ai/providers/selection";
  import { parseReviewMessageSections, type ReviewMessageSection } from "../ai/chatReviewContent";
  import type { ChatMessage, ChatModeId } from "../domain/contracts";

  interface Props {
    messages: ChatMessage[];
    isEmpty: boolean;
    isGenerating: boolean;
    activeMode: ChatModeId;
    compactionNotice?: string;
  }

  let { messages, isEmpty, isGenerating, activeMode, compactionNotice = "" }: Props = $props();

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

  function reviewSectionsForMessage(message: ChatMessage): ReviewMessageSection[] | null {
    if (message.role !== "assistant" || activeMode !== "review") {
      return null;
    }
    return parseReviewMessageSections(message.content);
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
        Ask or review ideas for this workspace. Pick a provider and mode, then send a message.
      </p>
    </div>
  {:else}
    <div class="chat-message-scroll">
      <ol class="chat-message-list" aria-label="Conversation">
        {#each messages as message, index (message.id)}
          <li
            class={`chat-message chat-message-${message.role}`}
            class:chat-message-system-event={isSystemEventMessage(message)}
            class:chat-message-streaming={isGenerating &&
              message.role === "assistant" &&
              index === messages.length - 1}
          >
            <p class="chat-message-role">{messageRoleLabel(message)}</p>
            {#if reviewSectionsForMessage(message)}
              <div class="chat-review-sections">
                {#each reviewSectionsForMessage(message) ?? [] as section (section.heading)}
                  <section class="chat-review-section">
                    <h3 class="chat-review-section-heading">{section.heading}</h3>
                    <p class="chat-review-section-body">{section.body}</p>
                  </section>
                {/each}
              </div>
            {:else}
              <p class="chat-message-content">
                {#if message.role === "assistant" && message.content.length === 0 && isGenerating && index === messages.length - 1}
                  <span class="chat-streaming-placeholder">Generating…</span>
                {:else}
                  {messageDisplayContent(message)}
                {/if}
              </p>
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
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    background: var(--color-surface-1);
  }

  .chat-message-user {
    border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-surface-1));
  }

  .chat-message-assistant {
    border-color: var(--color-border-subtle);
    background: var(--color-surface-1);
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

  .chat-message-streaming {
    border-style: dashed;
  }

  .chat-streaming-placeholder {
    color: var(--color-text-secondary);
    font-style: italic;
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
</style>
