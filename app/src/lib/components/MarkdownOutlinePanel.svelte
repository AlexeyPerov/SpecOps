<script lang="ts">
  import { onDestroy } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { EditorHost, MarkdownHeadingSnapshot } from "../types/editor";
  import { filterMarkdownHeadings } from "../editor/markdownHeadings";

  let {
    getHost,
    onJump,
    onClose,
    requestFocus = false,
  }: {
    getHost: () => EditorHost | null;
    onJump: (headingKey: string) => void;
    onClose: () => void;
    /** When true (focus command), focus the filter input once. */
    requestFocus?: boolean;
  } = $props();

  let filterQuery = $state("");
  let headings = $state.raw<MarkdownHeadingSnapshot[]>([]);
  let activeKey = $state<string | null>(null);
  let foldedKeys = $state.raw(new SvelteSet<string>());
  let filterInputEl = $state<HTMLInputElement | null>(null);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let selectedIndex = $state(0);

  const filtered = $derived(filterMarkdownHeadings(headings, filterQuery));
  const activeIndex = $derived(
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1),
  );

  function refreshFromHost(): void {
    if (disposed) {
      return;
    }
    const host = getHost();
    if (!host) {
      headings = [];
      activeKey = null;
      foldedKeys = new SvelteSet();
      return;
    }
    const list = host.queries.markdown.getHeadings();
    const active = host.queries.markdown.getActiveHeadingKey();
    headings = list.ok ? list.value : [];
    activeKey = active.ok ? active.value : null;
    const nextFolded = new SvelteSet<string>();
    for (const heading of headings) {
      const folded = host.queries.markdown.isHeadingFolded(heading.key);
      if (folded.ok && folded.value) {
        nextFolded.add(heading.key);
      }
    }
    foldedKeys = nextFolded;
  }

  function scheduleRefresh(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshFromHost();
    }, 80);
  }

  $effect(() => {
    refreshFromHost();
    const interval = setInterval(scheduleRefresh, 250);
    return () => {
      clearInterval(interval);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };
  });

  $effect(() => {
    if (requestFocus && filterInputEl) {
      filterInputEl.focus();
      filterInputEl.select();
    }
  });

  onDestroy(() => {
    disposed = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
  });

  function jumpTo(index: number): void {
    const heading = filtered[index];
    if (!heading) {
      return;
    }
    onJump(heading.key);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length === 0) {
        return;
      }
      selectedIndex = (activeIndex + 1) % filtered.length;
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) {
        return;
      }
      selectedIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      jumpTo(activeIndex);
    }
  }
</script>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="markdown-outline"
  role="complementary"
  aria-label="Markdown outline"
  tabindex="-1"
  onkeydown={handleKeydown}
>
  <div class="markdown-outline-header">
    <h3>Outline</h3>
    <button type="button" class="toolbar-button" onclick={onClose} aria-label="Close outline">
      Close
    </button>
  </div>
  <input
    bind:this={filterInputEl}
    class="markdown-outline-filter"
    type="search"
    placeholder="Filter headings…"
    aria-label="Filter headings"
    bind:value={filterQuery}
    onkeydown={handleKeydown}
  />
  {#if filtered.length === 0}
    <p class="markdown-outline-empty">
      {headings.length === 0 ? "No headings in this document." : "No matching headings."}
    </p>
  {:else}
    <ul class="markdown-outline-list" role="listbox" aria-label="Document headings">
      {#each filtered as heading, index (heading.key)}
        <li role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            class="markdown-outline-item"
            class:markdown-outline-item-active={heading.key === activeKey}
            class:markdown-outline-item-focused={index === activeIndex}
            class:markdown-outline-item-folded={foldedKeys.has(heading.key)}
            style:--outline-level={heading.level}
            aria-label={`Heading level ${heading.level}: ${heading.text}${foldedKeys.has(heading.key) ? ", folded" : ""}`}
            onclick={() => {
              selectedIndex = index;
              jumpTo(index);
            }}
          >
            <span class="markdown-outline-text">{heading.text || "(empty heading)"}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .markdown-outline {
    display: flex;
    flex-direction: column;
    width: min(240px, 36vw);
    min-width: 160px;
    max-width: 280px;
    height: 100%;
    min-height: 0;
    border-left: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
  }

  .markdown-outline-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .markdown-outline-header h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--color-text-secondary);
  }

  .markdown-outline-filter {
    margin: var(--space-4) var(--space-6);
    padding: 4px 8px;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-0, var(--color-surface-1));
    color: var(--color-text-primary);
    font-size: 12px;
  }

  .markdown-outline-filter:focus {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }

  .markdown-outline-empty {
    margin: 0;
    padding: var(--space-6);
    font-size: 12px;
    color: var(--color-text-secondary);
  }

  .markdown-outline-list {
    list-style: none;
    margin: 0;
    padding: 0 0 var(--space-6);
    overflow: auto;
    flex: 1 1 auto;
    min-height: 0;
  }

  .markdown-outline-item {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    padding: 3px var(--space-6);
    padding-left: calc(var(--space-6) + (var(--outline-level, 1) - 1) * 10px);
    font-size: 12px;
    line-height: 1.35;
    cursor: pointer;
    border-radius: 0;
  }

  .markdown-outline-item:hover {
    background: var(--color-hover);
  }

  .markdown-outline-item-focused {
    background: var(--color-hover);
  }

  .markdown-outline-item-active {
    color: var(--color-accent, var(--color-text-primary));
    font-weight: 600;
  }

  .markdown-outline-item-folded .markdown-outline-text::after {
    content: " …";
    color: var(--color-text-secondary);
    font-weight: 400;
  }

  .markdown-outline-text {
    display: inline;
    overflow-wrap: anywhere;
  }
</style>
