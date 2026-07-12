<script lang="ts">
  /**
   * Heading-jump picker — fuzzy heading search over the active Markdown
   * document's M4.2 heading model. Reuses the shared `SearchablePickerShell`
   * for combobox/listbox semantics, keyboard nav, Enter/Escape, and focus
   * restore. There is no second heading parser here: ranking is delegated to
   * `picker/headingRanking.ts`, which consumes `MarkdownHeadingSnapshot`
   * records and the existing `jumpToHeading` action.
   *
   * Rows show the heading level, the (highlighted) label, and a line-number /
   * hierarchy secondary label so duplicate heading texts stay distinguishable.
   * The heading nearest the cursor is flagged as current.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";
  import SearchablePickerOption from "./SearchablePickerOption.svelte";
  import { activeIndexAfterResultsChange } from "../picker/listNavigation";
  import { highlightSegments } from "../picker/highlightSegments";
  import type { RankedHeadingsResult } from "../picker/headingRanking";

  let {
    open = false,
    results,
    onSelect,
    onClose,
    onQueryInput,
  }: {
    open?: boolean;
    results: RankedHeadingsResult;
    onSelect: (headingKey: string) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  } = $props();

  const OPTION_ID_PREFIX = "heading-jump-option";
  const LIST_ID = "heading-jump-options";

  let query = $state("");
  let activeIndex = $state(0);

  const matches = $derived(results.matches);
  const optionCount = $derived(matches.length);

  // Reset query + selection each time the picker opens.
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

  // Keep the active index in bounds when results shrink.
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
    onSelect(match.heading.key);
  }

  const statusLabel = $derived.by((): string => {
    if (optionCount === 0) {
      return query.trim().length > 0 ? "No matching headings." : "No headings in this document.";
    }
    const total = results.totalMatches;
    if (results.truncated) {
      return `${total}+ matches (showing ${optionCount}).`;
    }
    return `${optionCount} heading${optionCount === 1 ? "" : "s"}.`;
  });
</script>

<SearchablePickerShell
  {open}
  label="Go to Heading"
  bind:query
  bind:activeIndex
  {optionCount}
  optionIdPrefix={OPTION_ID_PREFIX}
  listId={LIST_ID}
  placeholder="Search headings…"
  {onClose}
  onSelect={handleSelect}
  onQueryInput={handleQueryInput}
>
  {#each matches as match, i (match.heading.key)}
    <SearchablePickerOption index={i} active={i === activeIndex} idPrefix={OPTION_ID_PREFIX}>
      <div class="heading-jump-row">
        <span class="heading-jump-level" aria-hidden="true">H{match.heading.level}</span>
        <span class="heading-jump-text" aria-label={match.heading.text}>
          {#each highlightSegments(match.heading.text, match.ranges) as seg, segIndex (segIndex)}
            {#if seg.match}<mark class="heading-jump-match">{seg.text}</mark>{:else}{seg.text}{/if}
          {/each}
        </span>
        <span class="heading-jump-line">{match.hierarchyLabel}</span>
        {#if match.isCurrent}
          <span class="heading-jump-current" title="Current section">current</span>
        {/if}
      </div>
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    <div class="heading-jump-footer">
      <span class="heading-jump-status">{statusLabel}</span>
    </div>
  {/snippet}
</SearchablePickerShell>

<style>
  .heading-jump-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
  }

  .heading-jump-level {
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .heading-jump-text {
    grid-column: 2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
  }

  .heading-jump-line {
    grid-column: 3;
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .heading-jump-current {
    grid-column: 4;
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }

  .heading-jump-match {
    background: transparent;
    color: var(--color-accent);
    font-weight: 600;
  }

  .heading-jump-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .heading-jump-status {
    color: var(--color-text-secondary);
  }
</style>
