<script lang="ts">
  import type { MentionAgentEntry, MentionFileEntry } from "../ai/backends/opencodeSearch";

  /**
   * Presentational `@` mention picker with Files / Agents tabs (M3-T2).
   *
   * Two list types are merged into a single selection surface so the keyboard
   * (Up / Down / Enter) treats both as one ordered set: files first (the
   * OpenCode-ranked results), then agents. The parent owns the active index
   * because keyboard input arrives on the textarea.
   */
  interface Props {
    files: MentionFileEntry[];
    agents: MentionAgentEntry[];
    activeIndex: number;
    loading?: boolean;
    errorMessage?: string | null;
    onSelectFile: (file: MentionFileEntry) => void;
    onSelectAgent: (agent: MentionAgentEntry) => void;
    onHover?: (index: number) => void;
  }

  let {
    files,
    agents,
    activeIndex,
    loading = false,
    errorMessage = null,
    onSelectFile,
    onSelectAgent,
    onHover,
  }: Props = $props();

  // Flatten files + agents so the parent-computed activeIndex maps to a single
  // row regardless of kind. The order is stable: files, then agents.
  const rows = $derived.by(() => {
    const out: Array<{ kind: "file"; file: MentionFileEntry; index: number } | { kind: "agent"; agent: MentionAgentEntry; index: number }> = [];
    let index = 0;
    for (const file of files) {
      out.push({ kind: "file", file, index });
      index += 1;
    }
    for (const agent of agents) {
      out.push({ kind: "agent", agent, index });
      index += 1;
    }
    return out;
  });

  const hasContent = $derived(files.length > 0 || agents.length > 0);

  function handleClickFile(event: MouseEvent, file: MentionFileEntry): void {
    event.preventDefault();
    onSelectFile(file);
  }

  function handleClickAgent(event: MouseEvent, agent: MentionAgentEntry): void {
    event.preventDefault();
    onSelectAgent(agent);
  }
</script>

<div class="mention-picker" role="listbox" aria-label="Mentions">
  {#if loading}
    <div class="mention-picker-state">Searching files…</div>
  {:else if errorMessage}
    <div class="mention-picker-state mention-picker-state--error">{errorMessage}</div>
  {:else if !hasContent}
    <div class="mention-picker-state">No matches</div>
  {:else}
    {#if files.length > 0}
      <div class="mention-picker-section" aria-label="Files">
        <div class="mention-picker-section-label">Files</div>
        <ul class="mention-picker-list" role="presentation">
          {#each rows as row (row.index)}
            {#if row.kind === "file"}
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={row.index === activeIndex}
                  class={`mention-picker-item${row.index === activeIndex ? " is-active" : ""}`}
                  onclick={(event) => handleClickFile(event, row.file)}
                  onmouseenter={() => onHover?.(row.index)}
                  onfocus={() => onHover?.(row.index)}
                  title={row.file.path}
                >
                  <span class="mention-picker-item-icon" aria-hidden="true">📄</span>
                  <span class="mention-picker-item-name mention-picker-item-name--mono">{row.file.path}</span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
      </div>
    {/if}
    {#if agents.length > 0}
      <div class="mention-picker-section" aria-label="Agents">
        <div class="mention-picker-section-label">Agents</div>
        <ul class="mention-picker-list" role="presentation">
          {#each rows as row (row.index)}
            {#if row.kind === "agent"}
              <li role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={row.index === activeIndex}
                  class={`mention-picker-item${row.index === activeIndex ? " is-active" : ""}`}
                  onclick={(event) => handleClickAgent(event, row.agent)}
                  onmouseenter={() => onHover?.(row.index)}
                  onfocus={() => onHover?.(row.index)}
                  title={`@${row.agent.name}`}
                >
                  <span class="mention-picker-item-icon" aria-hidden="true">🤖</span>
                  <span class="mention-picker-item-name">{row.agent.name}</span>
                </button>
              </li>
            {/if}
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</div>

<style>
  .mention-picker {
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-popover);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .mention-picker-state {
    padding: var(--space-4) var(--space-6);
    font-size: 12px;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .mention-picker-state--error {
    color: var(--color-error);
  }

  .mention-picker-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .mention-picker-section-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-secondary);
    padding: 0 var(--space-3);
  }

  .mention-picker-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .mention-picker-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
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

  .mention-picker-item:hover,
  .mention-picker-item:focus-visible,
  .mention-picker-item.is-active {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--color-accent) 32%, transparent);
    outline: none;
  }

  .mention-picker-item-icon {
    flex-shrink: 0;
    font-size: 12px;
    line-height: 1;
  }

  .mention-picker-item-name {
    font-size: 12px;
    line-height: 1.3;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-picker-item-name--mono {
    font-family: monospace;
  }

  @media (prefers-reduced-motion: reduce) {
    .mention-picker-item {
      transition: none;
    }
  }
</style>
