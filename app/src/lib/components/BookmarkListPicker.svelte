<script lang="ts">
  /**
   * Bookmark list picker — fuzzy search over the active document's ephemeral
   * bookmarks. Reuses the shared `SearchablePickerShell` for combobox/listbox
   * semantics, keyboard nav, Enter/Escape, and focus restore. Selection jumps
   * to the bookmark's line (unfolding as needed) and focuses the editor.
   *
   * Rows show the line number and a bounded, trimmed line preview. Previews
   * never expose the full document and are never logged.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";
  import SearchablePickerOption from "./SearchablePickerOption.svelte";
  import { activeIndexAfterResultsChange } from "../picker/listNavigation";
  import { fuzzyRank } from "../picker/fuzzyRank";
  import { highlightSegments } from "../picker/highlightSegments";
  import type { EditorBookmarkSnapshot } from "../types/editor";

  let {
    open = false,
    bookmarks,
    onSelect,
    onClose,
    onQueryInput,
  }: {
    open?: boolean;
    bookmarks: readonly EditorBookmarkSnapshot[];
    onSelect: (line: number) => void;
    onClose: () => void;
    onQueryInput?: (query: string) => void;
  } = $props();

  const OPTION_ID_PREFIX = "bookmark-list-option";
  const LIST_ID = "bookmark-list-options";

  let query = $state("");
  let activeIndex = $state(0);

  const matches = $derived.by(() => {
    const candidates = bookmarks.map((bookmark) => ({
      item: bookmark,
      text: bookmark.preview || `(line ${bookmark.line})`,
      altTexts: [`line ${bookmark.line}`],
    }));
    return fuzzyRank(candidates, query);
  });

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
    onSelect(match.item.line);
  }

  const statusLabel = $derived.by((): string => {
    if (bookmarks.length === 0) {
      return "No bookmarks in this document.";
    }
    if (optionCount === 0) {
      return "No matching bookmarks.";
    }
    return `${optionCount} bookmark${optionCount === 1 ? "" : "s"}.`;
  });
</script>

<SearchablePickerShell
  {open}
  label="Bookmarks"
  bind:query
  bind:activeIndex
  {optionCount}
  optionIdPrefix={OPTION_ID_PREFIX}
  listId={LIST_ID}
  placeholder="Search bookmarks…"
  {onClose}
  onSelect={handleSelect}
  onQueryInput={handleQueryInput}
>
  {#each matches as match, i (`${match.item.line}:${i}`)}
    <SearchablePickerOption index={i} active={i === activeIndex} idPrefix={OPTION_ID_PREFIX}>
      <div class="bookmark-list-row">
        <span class="bookmark-list-line" aria-label={`Line ${match.item.line}`}>L{match.item.line}</span>
        <span class="bookmark-list-preview">
          {#each highlightSegments(match.item.preview || "(empty line)", match.ranges) as seg, segIndex (segIndex)}
            {#if seg.match}<mark class="bookmark-list-match">{seg.text}</mark>{:else}{seg.text}{/if}
          {/each}
        </span>
      </div>
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    <div class="bookmark-list-footer">
      <span class="bookmark-list-status">{statusLabel}</span>
    </div>
  {/snippet}
</SearchablePickerShell>

<style>
  .bookmark-list-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
  }

  .bookmark-list-line {
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
  }

  .bookmark-list-preview {
    grid-column: 2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
  }

  .bookmark-list-match {
    background: transparent;
    color: var(--color-accent);
    font-weight: 600;
  }

  .bookmark-list-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .bookmark-list-status {
    color: var(--color-text-secondary);
  }
</style>
