<script lang="ts">
  /**
   * Command palette — fuzzy command search over the palette catalog snapshot.
   * Reuses `SearchablePickerShell` for combobox/listbox semantics, keyboard nav,
   * Enter/Escape, and focus restore. Disabled rows stay navigable and show a
   * reason but do not dispatch.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";
  import SearchablePickerOption from "./SearchablePickerOption.svelte";
  import { activeIndexAfterResultsChange } from "../picker/listNavigation";
  import { highlightSegments } from "../picker/highlightSegments";
  import type { RankedCommand, RankedCommandsResult } from "../picker/commandRanking";

  let {
    open = false,
    results,
    onSelect,
    onClose,
    onQueryInput,
  }: {
    open?: boolean;
    results: RankedCommandsResult;
    onSelect: (commandId: string) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  } = $props();

  const OPTION_ID_PREFIX = "command-palette-option";
  const LIST_ID = "command-palette-options";

  let query = $state("");
  let activeIndex = $state(0);

  const matches = $derived(results.matches);
  const optionCount = $derived(matches.length);

  $effect(() => {
    if (open) {
      query = "";
      activeIndex = 0;
      onQueryInput?.("");
    }
  });

  function handleQueryInput(value: string): void {
    query = value;
    onQueryInput?.(value);
  }

  $effect(() => {
    const next = activeIndexAfterResultsChange(activeIndex, optionCount);
    if (next !== activeIndex) {
      activeIndex = next;
    }
  });

  function handleSelect(index: number): void {
    const match = matches[index];
    if (!match || !match.entry.runnable) {
      return;
    }
    onSelect(match.entry.id);
  }

  const statusLabel = $derived.by((): string => {
    if (optionCount === 0) {
      return query.trim().length > 0 ? "No matching commands." : "No commands available.";
    }
    const total = results.totalMatches;
    if (results.truncated) {
      return `${total}+ matches (showing ${optionCount}).`;
    }
    return `${optionCount} command${optionCount === 1 ? "" : "s"}.`;
  });
</script>

<SearchablePickerShell
  {open}
  label="Command Palette"
  bind:query
  bind:activeIndex
  {optionCount}
  optionIdPrefix={OPTION_ID_PREFIX}
  listId={LIST_ID}
  placeholder="Search commands…"
  {onClose}
  onSelect={handleSelect}
  onQueryInput={handleQueryInput}
>
  {#each matches as match, i (match.entry.id)}
    {@const disabled = !match.entry.runnable}
    <SearchablePickerOption
      index={i}
      active={i === activeIndex}
      idPrefix={OPTION_ID_PREFIX}
      {disabled}
    >
      <div class="command-palette-row">
        <span class="command-palette-label" aria-label={match.entry.label}>
          {#each highlightSegments(match.entry.label, match.ranges) as seg, segIndex (segIndex)}
            {#if seg.match}<mark class="command-palette-match">{seg.text}</mark>{:else}{seg.text}{/if}
          {/each}
        </span>
        <span class="command-palette-category">{match.entry.category}</span>
        {#if match.entry.displayBinding}
          <span class="command-palette-binding">{match.entry.displayBinding}</span>
        {/if}
        {#if match.entry.disabledReason}
          <span class="command-palette-reason">{match.entry.disabledReason}</span>
        {/if}
      </div>
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    <div class="command-palette-footer">
      <span class="command-palette-status">{statusLabel}</span>
    </div>
  {/snippet}
</SearchablePickerShell>

<style>
  .command-palette-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
  }

  .command-palette-label {
    grid-column: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
  }

  .command-palette-category {
    grid-column: 2;
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .command-palette-binding {
    grid-column: 3;
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .command-palette-reason {
    grid-column: 1 / -1;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .command-palette-match {
    background: transparent;
    color: var(--color-accent);
    font-weight: 600;
  }

  .command-palette-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .command-palette-status {
    color: var(--color-text-secondary);
  }
</style>
