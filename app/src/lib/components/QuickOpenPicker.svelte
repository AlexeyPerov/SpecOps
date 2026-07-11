<script lang="ts">
  /**
   * Quick Open file picker — fuzzy file search over the active workspace
   * catalog. Renders basename as primary text (with match-range highlights)
   * and the relative directory as secondary text. Reuses the shared
   * `SearchablePickerShell` for combobox/listbox semantics, keyboard nav,
   * Enter/Escape, and focus restore.
   *
   * The picker owns its query/activeIndex state so repeated `Cmd+P` presses
   * focus the existing query rather than mounting a duplicate overlay. The
   * route controller gates `open` and supplies the ranked results + catalog
   * metadata; selection is delegated back to the controller's `onSelect`.
   */
  import SearchablePickerShell from "./SearchablePickerShell.svelte";
  import SearchablePickerOption from "./SearchablePickerOption.svelte";
  import { activeIndexAfterResultsChange } from "../picker/listNavigation";
  import { highlightSegments } from "../picker/highlightSegments";
  import type { RankedFile, RankedFilesResult } from "../picker/fileRanking";

  let {
    open = false,
    results,
    onSelect,
    onClose,
    onRefresh,
    onQueryInput,
  }: {
    open?: boolean;
    results: RankedFilesResult;
    onSelect: (path: string) => void;
    onClose: () => void;
    onRefresh?: () => void;
    onQueryInput?: (query: string) => void;
  } = $props();

  const OPTION_ID_PREFIX = "quick-open-option";
  const LIST_ID = "quick-open-options";

  let query = $state("");
  let activeIndex = $state(0);

  const matches = $derived(results.matches);
  const optionCount = $derived(matches.length);

  // Reset query + selection each time the picker opens so stale text from a
  // previous session does not linger. The shell focuses the input on open.
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

  // Keep the active index in bounds when results shrink (query narrowed,
  // catalog rebuilt, etc.). Grow-from-empty resets to 0.
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
    onSelect(match.entry.absolutePath);
  }

  function relativeDirectory(entry: RankedFile): string {
    // Show the directory relative to the workspace root.
    // `entry.entry.relativePath` is forward-slash relative; the directory is
    // everything before the last slash.
    const rel = entry.entry.relativePath;
    const slash = rel.lastIndexOf("/");
    return slash >= 0 ? rel.slice(0, slash) : "";
  }

  const statusLabel = $derived.by((): string => {
    const status = results.status;
    if (status === "loading") {
      return "Indexing files…";
    }
    if (status === "error") {
      return "File index error.";
    }
    if (status === "idle") {
      return "No workspace open.";
    }
    if (optionCount === 0) {
      return query.trim().length > 0 ? "No matching files." : "No files found.";
    }
    const total = results.totalMatches;
    const scanned = results.scannedCount;
    if (results.truncated) {
      return `${total}+ matches (showing ${optionCount}) in ${scanned} files.`;
    }
    return `${optionCount} of ${scanned} file${scanned === 1 ? "" : "s"}.`;
  });
</script>

<SearchablePickerShell
  {open}
  label="Quick Open"
  bind:query
  bind:activeIndex
  {optionCount}
  optionIdPrefix={OPTION_ID_PREFIX}
  listId={LIST_ID}
  placeholder="Search files by name…"
  {onClose}
  onSelect={handleSelect}
  onQueryInput={handleQueryInput}
>
  {#each matches as match, i (match.entry.key)}
    <SearchablePickerOption index={i} active={i === activeIndex} idPrefix={OPTION_ID_PREFIX}>
      <div class="quick-open-row">
        <span class="quick-open-basename" aria-label={match.entry.basename}>
          {#each highlightSegments(match.entry.basename, match.ranges) as seg}
            {#if seg.match}<mark class="quick-open-match">{seg.text}</mark>{:else}{seg.text}{/if}
          {/each}
        </span>
        {#if relativeDirectory(match)}
          <span class="quick-open-dir">{relativeDirectory(match)}</span>
        {/if}
        {#if match.recency === "open"}
          <span class="quick-open-badge" title="Currently open">open</span>
        {:else if match.recency === "recent"}
          <span class="quick-open-badge" title="Recently opened">recent</span>
        {/if}
      </div>
    </SearchablePickerOption>
  {/each}
  {#snippet footer()}
    <div class="quick-open-footer">
      <span class="quick-open-status">{statusLabel}</span>
      {#if onRefresh}
        <button
          type="button"
          class="quick-open-refresh"
          onclick={onRefresh}
          title="Refresh file index"
        >
          Refresh
        </button>
      {/if}
    </div>
  {/snippet}
</SearchablePickerShell>

<style>
  .quick-open-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
  }

  .quick-open-basename {
    flex: 0 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--color-text-primary);
  }

  .quick-open-dir {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .quick-open-match {
    background: transparent;
    color: var(--color-accent);
    font-weight: 600;
  }

  .quick-open-badge {
    flex: 0 0 auto;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
  }

  .quick-open-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
  }

  .quick-open-status {
    color: var(--color-text-secondary);
  }

  .quick-open-refresh {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    padding: 2px var(--space-6);
    font: inherit;
    font-size: var(--font-size-status);
    cursor: pointer;
  }

  .quick-open-refresh:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }
</style>
