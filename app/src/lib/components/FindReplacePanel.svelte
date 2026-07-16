<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { EditorCommandRunner } from "../types/editor";
  import { createSearchQuery, validateSearchQuery, type SearchQuery } from "../editor/searchQuery";

  let {
    findQuery = $bindable(""),
    replaceValue = $bindable(""),
    findCaseSensitive = $bindable(false),
    findWholeWord = $bindable(false),
    findRegexp = $bindable(false),
    /** Non-empty selection text to seed the query with on first open. */
    seedSelection = "",
    getEditorRunner = (() => null) as () => EditorCommandRunner | null,
    notify = (_message: string) => {},
    documentId = null as string | null,
    onClose = () => {},
  }: {
    findQuery?: string;
    replaceValue?: string;
    findCaseSensitive?: boolean;
    findWholeWord?: boolean;
    findRegexp?: boolean;
    seedSelection?: string;
    getEditorRunner?: () => EditorCommandRunner | null;
    notify?: (message: string) => void;
    documentId?: string | null;
    onClose?: () => void;
  } = $props();

  let findInputEl = $state<HTMLInputElement | undefined>(undefined);
  let replaceInputEl = $state<HTMLInputElement | undefined>(undefined);
  let panelEl = $state<HTMLElement | undefined>(undefined);
  let matchCount = $state(0);
  let currentMatch = $state(0);
  // Imperative timer — not reactive state.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let showReplace = $state(true);
  let mounted = false;

  /** The unified query assembled from the panel's toggle state. */
  const query = $derived(
    createSearchQuery({
      text: findQuery,
      replacement: replaceValue,
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
      regexp: findRegexp,
    }),
  );

  /** Inline validation: invalid regex disables navigation and replacement. */
  const validation = $derived(validateSearchQuery(query));
  const queryError = $derived(
    findQuery && !validation.ok ? validation.reason : "",
  );
  const canSearch = $derived(findQuery.trim().length > 0 && validation.ok);

  const matchCountText = $derived(
    findQuery
      ? matchCount === 0
        ? "No results"
        : currentMatch === 0
          ? `${matchCount} found`
          : `${currentMatch}/${matchCount}`
      : "",
  );

  function close(): void {
    getEditorRunner()?.setSearchQuery(
      createSearchQuery({ text: "", regexp: false }),
    );
    onClose();
  }

  function runIncrementalSearch(): void {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    const runner = getEditorRunner();
    if (!findQuery || !validation.ok) {
      matchCount = 0;
      currentMatch = 0;
      runner?.setSearchQuery(createSearchQuery({ text: "", regexp: false }));
      return;
    }
    runner?.setSearchQuery(query);
    runner?.findNext(query);
    updateMatchInfo();
  }

  function scheduleSearch(): void {
    if (!mounted) return;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(runIncrementalSearch, 120);
  }

  function updateMatchInfo(): void {
    const runner = getEditorRunner();
    if (!findQuery || !runner || !validation.ok) {
      matchCount = 0;
      currentMatch = 0;
      return;
    }
    const info = runner.getMatchInfo(query);
    matchCount = info.total;
    currentMatch = info.current;
  }

  function findNext(): void {
    if (!canSearch) return;
    getEditorRunner()?.findNext(query);
    updateMatchInfo();
  }

  function findPrev(): void {
    if (!canSearch) return;
    getEditorRunner()?.findPrevious(query);
    updateMatchInfo();
  }

  function replaceCurrent(): void {
    if (!canSearch) return;
    const replaced = getEditorRunner()?.replaceAndFindNext(query) ?? false;
    if (replaced) {
      updateMatchInfo();
    } else {
      notify("No match to replace.");
    }
  }

  function replaceAll(): void {
    if (!canSearch) return;
    const runner = getEditorRunner();
    const count = runner?.replaceAll(query) ?? 0;
    notify(`Replaced ${count} occurrence(s).`);
    runner?.setSearchQuery(query);
    updateMatchInfo();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const isMod = event.metaKey || event.ctrlKey;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === "F3") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
      return;
    }

    if (isMod && event.key.toLowerCase() === "f") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
      return;
    }

    if (event.key === "Tab" && !isMod) {
      const focused = document.activeElement;
      if (focused === findInputEl && showReplace && replaceInputEl) {
        event.preventDefault();
        replaceInputEl.focus();
        return;
      }
      if (focused === replaceInputEl && findInputEl) {
        event.preventDefault();
        findInputEl.focus();
        return;
      }
    }
  }

  onMount(() => {
    mounted = true;
    panelEl?.addEventListener("keydown", handleKeydown);
    // Seed the query from a non-empty single selection on first open.
    if (!findQuery && seedSelection) {
      findQuery = seedSelection;
    }
    findInputEl?.focus();
    findInputEl?.select();
    if (findQuery) {
      runIncrementalSearch();
    }

    return () => {
      panelEl?.removeEventListener("keydown", handleKeydown);
    };
  });

  onDestroy(() => {
    mounted = false;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    getEditorRunner()?.setSearchQuery(createSearchQuery({ text: "", regexp: false }));
  });

  $effect(() => {
    if (!mounted || !documentId) {
      return;
    }
    const runner = getEditorRunner();
    if (findQuery && runner && validation.ok) {
      runner.setSearchQuery(query);
      updateMatchInfo();
    }
  });
</script>

<search bind:this={panelEl} class="find-replace-panel" aria-label="Find and Replace">
  <div class="fr-row">
    <button
      type="button"
      class="fr-chevron"
      title={showReplace ? "Hide replace" : "Show replace"}
      onclick={() => (showReplace = !showReplace)}
    >
      {showReplace ? "▾" : "▸"}
    </button>
    <div class="fr-field-group">
      <input
        type="text"
        class="fr-input"
        class:fr-input-error={Boolean(queryError)}
        placeholder="Find..."
        bind:value={findQuery}
        bind:this={findInputEl}
        oninput={scheduleSearch}
        aria-invalid={Boolean(queryError)}
        aria-label="Find"
      />
      <span class="fr-counter">{matchCountText}</span>
      <button
        type="button"
        class="search-control-btn"
        class:search-control-btn-active={findCaseSensitive}
        title="Match case"
        aria-pressed={findCaseSensitive}
        onclick={() => {
          findCaseSensitive = !findCaseSensitive;
          scheduleSearch();
        }}
      >
        Aa
      </button>
      <button
        type="button"
        class="search-control-btn"
        class:search-control-btn-active={findWholeWord}
        title="Whole word"
        aria-pressed={findWholeWord}
        onclick={() => {
          findWholeWord = !findWholeWord;
          scheduleSearch();
        }}
      >
        W
      </button>
      <button
        type="button"
        class="search-control-btn"
        class:search-control-btn-active={findRegexp}
        title="Regular expression"
        aria-pressed={findRegexp}
        onclick={() => {
          findRegexp = !findRegexp;
          scheduleSearch();
        }}
      >
        .*
      </button>
      <button type="button" class="search-control-btn" title="Previous (Shift+Enter)" disabled={!canSearch} onclick={findPrev}>
        &#x25B2;
      </button>
      <button type="button" class="search-control-btn" title="Next (Enter)" disabled={!canSearch} onclick={findNext}>
        &#x25BC;
      </button>
      <button type="button" class="search-control-btn search-control-btn-close" title="Close (Escape)" onclick={close}>
        &times;
      </button>
    </div>
  </div>
  {#if queryError}
    <div class="fr-error" role="alert">{queryError}</div>
  {/if}
  {#if showReplace}
    <div class="fr-row">
      <div class="fr-chevron-spacer"></div>
      <div class="fr-field-group">
        <input
          type="text"
          class="fr-input"
          placeholder="Replace..."
          bind:value={replaceValue}
          bind:this={replaceInputEl}
          aria-label="Replace"
        />
        <button type="button" class="search-control-btn search-control-btn-wide" title="Replace current match" disabled={!canSearch} onclick={replaceCurrent}>
          Replace
        </button>
        <button type="button" class="search-control-btn search-control-btn-wide" title="Replace all matches" disabled={!canSearch} onclick={replaceAll}>
          All
        </button>
      </div>
    </div>
  {/if}
</search>

<style>
  .find-replace-panel {
    position: absolute;
    top: var(--space-8);
    right: var(--space-12);
    /* Responsive: clamp between a usable minimum and a sensible maximum
       instead of a fixed width that overflows narrow panes. */
    width: clamp(320px, 90%, 480px);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-4) var(--space-6);
    display: grid;
    gap: var(--space-4);
    z-index: 10;
  }

  .fr-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .fr-field-group {
    /* Groups the field with its action buttons as a single left-aligned cluster
       so the buttons stay inside the panel (just to the right of the input)
       rather than being pushed against / past the rounded right edge. */
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .fr-chevron {
    width: 20px;
    height: var(--space-12);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
  }

  .fr-chevron:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .fr-chevron-spacer {
    width: 20px;
    flex-shrink: 0;
  }

  .fr-input {
    /* Grows inside .fr-field-group (which is bounded by the panel's padding) so
       the trailing action buttons always follow the field and stay inside the
       panel instead of being pushed past the rounded right edge. */
    flex: 1 1 160px;
    min-width: 0;
    height: var(--space-12);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-bg-root);
    color: var(--color-text-primary);
    padding: 0 var(--space-6);
    font-size: var(--font-size-body);
    font-family: var(--font-family-ui);
    outline: none;
  }

  .fr-input:focus {
    border-color: var(--color-accent);
  }

  .fr-input-error {
    border-color: var(--color-danger);
  }

  .fr-counter {
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
    min-width: 44px;
    text-align: right;
    flex-shrink: 0;
  }

  .fr-error {
    margin-left: calc(20px + var(--space-3));
    font-size: var(--font-size-status);
    color: var(--color-danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Search controls use the shared .search-control-btn vocabulary (U3.1). */
</style>
