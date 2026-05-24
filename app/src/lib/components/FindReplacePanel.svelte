<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { EditorCommandRunner } from "../types/editor";
  import { appState } from "../state/appState";

  export let findQuery = "";
  export let replaceValue = "";
  export let findCaseSensitive = false;
  export let editorRunner: EditorCommandRunner | null = null;
  export let notify: (message: string) => void = () => {};
  export let documentId: string | null = null;

  let findInputEl: HTMLInputElement | undefined;
  let replaceInputEl: HTMLInputElement | undefined;
  let matchCount = 0;
  let currentMatch = 0;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let showReplace = true;
  let mounted = false;

  $: matchCountText = findQuery
    ? matchCount === 0
      ? "No results"
      : currentMatch === 0
        ? `${matchCount} found`
        : `${currentMatch}/${matchCount}`
    : "";

  function close(): void {
    editorRunner?.setSearchQuery("", false);
    appState.setFindReplaceOpen(false);
  }

  function runIncrementalSearch(): void {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    if (!findQuery) {
      matchCount = 0;
      currentMatch = 0;
      editorRunner?.setSearchQuery("", false);
      return;
    }
    editorRunner?.setSearchQuery(findQuery, findCaseSensitive);
    editorRunner?.findNext(findQuery, findCaseSensitive);
    updateMatchInfo();
  }

  function scheduleSearch(): void {
    if (!mounted) return;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(runIncrementalSearch, 120);
  }

  function updateMatchInfo(): void {
    if (!findQuery || !editorRunner) {
      matchCount = 0;
      currentMatch = 0;
      return;
    }
    const info = editorRunner.getMatchInfo(findQuery, findCaseSensitive);
    matchCount = info.total;
    currentMatch = info.current;
  }

  function findNext(): void {
    if (!findQuery.trim()) return;
    editorRunner?.findNext(findQuery, findCaseSensitive);
    updateMatchInfo();
  }

  function findPrev(): void {
    if (!findQuery.trim()) return;
    editorRunner?.findPrevious(findQuery, findCaseSensitive);
    updateMatchInfo();
  }

  function replaceCurrent(): void {
    if (!findQuery.trim()) return;
    const replaced =
      editorRunner?.replaceAndFindNext(
        findQuery,
        replaceValue,
        findCaseSensitive,
      ) ?? false;
    if (replaced) {
      updateMatchInfo();
    } else {
      notify("No match to replace.");
    }
  }

  function replaceAll(): void {
    if (!findQuery.trim()) return;
    const count =
      editorRunner?.replaceAll(findQuery, replaceValue, findCaseSensitive) ?? 0;
    notify(`Replaced ${count} occurrence(s).`);
    editorRunner?.setSearchQuery(findQuery, findCaseSensitive);
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
    findInputEl?.focus();
    findInputEl?.select();
    if (findQuery) {
      runIncrementalSearch();
    }
  });

  onDestroy(() => {
    mounted = false;
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    editorRunner?.setSearchQuery("", false);
  });

  $: if (mounted && documentId) {
    if (findQuery && editorRunner) {
      editorRunner.setSearchQuery(findQuery, findCaseSensitive);
      updateMatchInfo();
    }
  }
</script>

<div
  class="find-replace-panel"
  role="search"
  tabindex="-1"
  aria-label="Find and Replace"
  onkeydown={handleKeydown}
>
  <div class="fr-row">
    <button
      type="button"
      class="fr-chevron"
      title={showReplace ? "Hide replace" : "Show replace"}
      onclick={() => (showReplace = !showReplace)}
    >
      {showReplace ? "▾" : "▸"}
    </button>
    <input
      type="text"
      class="fr-input"
      placeholder="Find..."
      bind:value={findQuery}
      bind:this={findInputEl}
      oninput={scheduleSearch}
    />
    <span class="fr-counter">{matchCountText}</span>
    <button
      type="button"
      class="fr-btn"
      class:fr-btn-active={findCaseSensitive}
      title="Match case"
      onclick={() => {
        findCaseSensitive = !findCaseSensitive;
        scheduleSearch();
      }}
    >
      Aa
    </button>
    <button type="button" class="fr-btn" title="Previous (Shift+Enter)" onclick={findPrev}>
      &#x25B2;
    </button>
    <button type="button" class="fr-btn" title="Next (Enter)" onclick={findNext}>
      &#x25BC;
    </button>
    <button type="button" class="fr-btn fr-btn-close" title="Close (Escape)" onclick={close}>
      &times;
    </button>
  </div>
  {#if showReplace}
    <div class="fr-row">
      <div class="fr-chevron-spacer"></div>
      <input
        type="text"
        class="fr-input"
        placeholder="Replace..."
        bind:value={replaceValue}
        bind:this={replaceInputEl}
      />
      <button type="button" class="fr-btn fr-btn-wide" title="Replace current match" onclick={replaceCurrent}>
        Replace
      </button>
      <button type="button" class="fr-btn fr-btn-wide" title="Replace all matches" onclick={replaceAll}>
        All
      </button>
    </div>
  {/if}
</div>

<style>
  .find-replace-panel {
    position: absolute;
    top: var(--space-8);
    right: var(--space-12);
    width: 400px;
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
    gap: var(--space-4);
  }

  .fr-chevron {
    width: 20px;
    height: 24px;
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
    flex: 1;
    min-width: 0;
    height: 26px;
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

  .fr-counter {
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
    white-space: nowrap;
    min-width: 56px;
    text-align: right;
    flex-shrink: 0;
  }

  .fr-btn {
    height: 24px;
    min-width: 24px;
    padding: 0 var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-family: var(--font-family-ui);
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .fr-btn:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .fr-btn-wide {
    padding: 0 var(--space-6);
  }

  .fr-btn-active {
    background: var(--color-hover);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }

  .fr-btn-close {
    font-size: 15px;
    font-weight: 600;
  }
</style>
