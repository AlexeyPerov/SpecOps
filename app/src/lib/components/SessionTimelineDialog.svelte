<script lang="ts">
  import type { ChatMessage } from "../domain/contracts";

  /**
   * M5-T5 — session timeline dialog. Scrollable list of every message in the
   * active transcript with role + timestamp, search/filter, and click-to-jump
   * (delegates to the parent, which scrolls the transcript). Modeled on the
   * SessionListPanel modal pattern.
   */
  interface Props {
    open: boolean;
    messages?: readonly ChatMessage[];
    searchQuery?: string;
    onJumpToMessage?: (messageId: string) => void;
    onClose?: () => void;
    onSearchChange?: (query: string) => void;
  }

  let {
    open,
    messages = [],
    searchQuery = "",
    onJumpToMessage,
    onClose,
    onSearchChange,
  }: Props = $props();

  let backdropEl = $state<HTMLDivElement | null>(null);

  function handleBackdropPointerDown(event: PointerEvent): void {
    if (event.target === backdropEl) {
      onClose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
    }
  }

  const filtered = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length === 0) {
      return messages;
    }
    return messages.filter((message) => {
      if (message.content.toLowerCase().includes(query)) {
        return true;
      }
      return message.role.includes(query);
    });
  });

  function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString();
  }

  function roleLabel(role: ChatMessage["role"]): string {
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  function preview(message: ChatMessage): string {
    const text = message.content.trim();
    if (text.length === 0) {
      return "(no text)";
    }
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <div
    bind:this={backdropEl}
    class="timeline-backdrop"
    role="presentation"
    onpointerdown={handleBackdropPointerDown}
  >
    <div
      class="timeline-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="timeline-title"
      onclick={(event) => event.stopPropagation()}
      onpointerdown={(event) => event.stopPropagation()}
    >
      <header class="timeline-header">
        <h2 id="timeline-title" class="timeline-title">Timeline</h2>
        <div class="timeline-controls">
          <label class="timeline-search">
            <input
              type="search"
              placeholder="Filter messages…"
              value={searchQuery}
              oninput={(e) => onSearchChange?.(e.currentTarget.value)}
            />
          </label>
          <button type="button" class="toolbar-button" onclick={onClose}>Close</button>
        </div>
      </header>

      <div class="timeline-body">
        {#if filtered.length === 0}
          <p class="timeline-empty">
            {searchQuery.trim() ? "No messages match your filter." : "No messages yet."}
          </p>
        {:else}
          <ol class="timeline-list">
            {#each filtered as message (message.id)}
              <li>
                <button
                  type="button"
                  class={`timeline-row timeline-row-${message.role}`}
                  onclick={() => {
                    onJumpToMessage?.(message.id);
                    onClose?.();
                  }}
                >
                  <span class="timeline-row-role">{roleLabel(message.role)}</span>
                  <span class="timeline-row-preview">{preview(message)}</span>
                  <span class="timeline-row-time">{formatTimestamp(message.createdAt)}</span>
                </button>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .timeline-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: grid;
    place-items: center;
    background: var(--color-surface-overlay);
  }

  .timeline-dialog {
    width: min(640px, calc(100vw - 2 * var(--space-12)));
    max-height: min(640px, calc(100vh - 2 * var(--space-12)));
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .timeline-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .timeline-title {
    margin: 0;
    font-size: var(--font-size-status);
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .timeline-controls {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .timeline-search {
    flex: 1;
  }

  .timeline-search input {
    width: 100%;
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    padding: 0 var(--space-4);
    font: inherit;
    font-size: 11px;
  }

  .timeline-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-6) var(--space-10);
  }

  .timeline-empty {
    margin: 0;
    padding: var(--space-10) 0;
    text-align: center;
    color: var(--color-text-secondary);
    font-size: 12px;
  }

  .timeline-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    counter-reset: timeline;
  }

  .timeline-row {
    width: 100%;
    display: grid;
    grid-template-columns: 64px 1fr auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .timeline-row:hover {
    background: var(--color-hover);
  }

  .timeline-row-role {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-secondary);
  }

  .timeline-row-user .timeline-row-role {
    color: var(--color-accent);
  }

  .timeline-row-preview {
    font-size: 12px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timeline-row-time {
    font-size: 10px;
    color: var(--color-text-secondary);
    white-space: nowrap;
  }
</style>
