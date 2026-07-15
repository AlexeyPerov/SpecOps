<script lang="ts">
  /**
   * Insert-snippet picker — searchable list of enabled Markdown snippets.
   * Reuses SearchablePickerShell; selection inserts via the host action and
   * restores editor focus with placeholder mode active.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";
  import SearchablePickerOption from "./SearchablePickerOption.svelte";
  import { activeIndexAfterResultsChange } from "../picker/listNavigation";
  import { highlightSegments } from "../picker/highlightSegments";
  import type { RankedSnippetsResult } from "../picker/snippetRanking";
  import { openSettingsDialog } from "../services/settingsDialogUi";

  let {
    open = false,
    results,
    onSelect,
    onClose,
    onQueryInput,
  }: {
    open?: boolean;
    results: RankedSnippetsResult;
    onSelect: (snippetId: string) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  } = $props();

  const OPTION_ID_PREFIX = "snippet-insert-option";
  const LIST_ID = "snippet-insert-options";

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
    if (!match) {
      return;
    }
    onSelect(match.item.id);
  }

  function openSnippetSettings(): void {
    onClose();
    openSettingsDialog("editor");
  }

  const statusLabel = $derived.by((): string => {
    if (optionCount === 0) {
      return query.trim().length > 0
        ? "No matching snippets."
        : "No enabled snippets. Add or enable them in Settings → Editor.";
    }
    if (results.truncated) {
      return `${results.totalMatches}+ matches (showing ${optionCount}).`;
    }
    return `${optionCount} snippet${optionCount === 1 ? "" : "s"}.`;
  });
</script>

<SearchablePickerShell
  {open}
  label="Insert Snippet"
  bind:query
  bind:activeIndex
  {optionCount}
  optionIdPrefix={OPTION_ID_PREFIX}
  listId={LIST_ID}
  placeholder="Search snippets…"
  {onClose}
  onSelect={handleSelect}
  onQueryInput={handleQueryInput}
>
  {#each matches as match, i (match.item.id)}
    <SearchablePickerOption index={i} active={i === activeIndex} idPrefix={OPTION_ID_PREFIX}>
      <div class="snippet-insert-row">
        <span class="snippet-insert-name" aria-label={match.item.name}>
          {#each highlightSegments(match.item.name, match.ranges) as seg, segIndex (segIndex)}
            {#if seg.match}<mark class="snippet-insert-match">{seg.text}</mark>{:else}{seg.text}{/if}
          {/each}
        </span>
        <span class="snippet-insert-trigger">{match.item.trigger}</span>
        <span class="snippet-insert-source">{match.sourceLabel}</span>
        {#if match.item.description}
          <span class="snippet-insert-desc">{match.item.description}</span>
        {/if}
      </div>
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    <div class="snippet-insert-footer">
      <span class="snippet-insert-status">{statusLabel}</span>
      {#if optionCount === 0 && query.trim().length === 0}
        <button type="button" class="snippet-insert-settings-link" onclick={openSnippetSettings}>
          Open snippet settings
        </button>
      {/if}
    </div>
  {/snippet}
</SearchablePickerShell>

<style>
  .snippet-insert-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-rows: auto auto;
    gap: 2px var(--space-6);
    min-width: 0;
  }

  .snippet-insert-name {
    grid-column: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
  }

  .snippet-insert-trigger {
    grid-column: 2;
    font-family: var(--font-family-mono, monospace);
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .snippet-insert-source {
    grid-column: 3;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .snippet-insert-desc {
    grid-column: 1 / -1;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .snippet-insert-match {
    background: transparent;
    color: var(--color-accent);
    font-weight: 600;
  }

  .snippet-insert-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .snippet-insert-status {
    color: var(--color-text-secondary);
  }

  .snippet-insert-settings-link {
    border: none;
    background: transparent;
    color: var(--color-accent);
    font: inherit;
    font-size: var(--font-size-status);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }

  .snippet-insert-settings-link:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
</style>
