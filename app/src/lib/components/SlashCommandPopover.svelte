<script lang="ts">
  import type { OpencodeCommandEntry } from "../ai/backends/workspaceAgentBackend";

  /**
   * Presentational popover that lists slash commands filtered by the user's
   * `/query`. Selection (active index, keyboard navigation) is owned here;
   * insertion happens via `onSelect` when the user picks Enter / clicks.
   *
   * The parent (ChatComposer) is responsible for showing / hiding this
   * component based on the cursor trigger and for applying the template via
   * `buildSlashReplacement`.
   */
  interface Props {
    commands: OpencodeCommandEntry[];
    /** Active index within `commands` (parent-controlled so keyboard input
     * from the textarea can move the highlight). */
    activeIndex: number;
    loading?: boolean;
    errorMessage?: string | null;
    onSelect: (command: OpencodeCommandEntry) => void;
    onHover?: (index: number) => void;
  }

  let {
    commands,
    activeIndex,
    loading = false,
    errorMessage = null,
    onSelect,
    onHover,
  }: Props = $props();

  function handleClick(event: MouseEvent, command: OpencodeCommandEntry): void {
    event.preventDefault();
    onSelect(command);
  }
</script>

<div class="slash-popover" role="listbox" aria-label="Slash commands">
  {#if loading}
    <div class="slash-popover-state">Loading commands…</div>
  {:else if errorMessage}
    <div class="slash-popover-state slash-popover-state--error">{errorMessage}</div>
  {:else if commands.length === 0}
    <div class="slash-popover-state">No matching commands</div>
  {:else}
    <ul class="slash-popover-list" role="presentation">
      {#each commands as command, index (command.name)}
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            class={`slash-popover-item${index === activeIndex ? " is-active" : ""}`}
            onclick={(event) => handleClick(event, command)}
            onmouseenter={() => onHover?.(index)}
            onfocus={() => onHover?.(index)}
            title={command.description ?? command.template}
          >
            <span class="slash-popover-item-name">/{command.name}</span>
            {#if command.description}
              <span class="slash-popover-item-desc">{command.description}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .slash-popover {
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-popover);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .slash-popover-state {
    padding: var(--space-4) var(--space-6);
    font-size: 12px;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .slash-popover-state--error {
    color: var(--color-error);
  }

  .slash-popover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .slash-popover-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .slash-popover-item:hover,
  .slash-popover-item:focus-visible,
  .slash-popover-item.is-active {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
    outline: none;
  }

  .slash-popover-item-name {
    font-family: monospace;
    font-size: 12px;
    line-height: 1.3;
    color: var(--color-text-primary);
  }

  .slash-popover-item-desc {
    font-size: 11px;
    line-height: 1.3;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .slash-popover-item {
      transition: none;
    }
  }
</style>
