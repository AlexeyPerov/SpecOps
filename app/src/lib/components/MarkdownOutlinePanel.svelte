<script lang="ts">
  import { onDestroy } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type { EditorHost, EditorHostIdentity, MarkdownHeadingSnapshot } from "../types/editor";
  import { filterMarkdownHeadings } from "../editor/markdownHeadings";
  import {
    resolveOutlineHostBinding,
    shouldPublishOutlineSnapshot,
  } from "../editor/markdownOutlineHostBinding";

  let {
    getHost,
    documentId = null,
    paneId,
    onJump,
    onClose,
    requestFocus = false,
  }: {
    getHost: () => EditorHost | null;
    /** Selected document in this pane — drives event-driven refresh on tab switch. */
    documentId?: string | null;
    paneId: string;
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
  /** Binding last successfully published; used to drop stale delayed refreshes. */
  let publishedBinding = $state.raw<EditorHostIdentity | null>(null);

  const filtered = $derived(filterMarkdownHeadings(headings, filterQuery));
  const activeIndex = $derived(
    filtered.length === 0 ? 0 : Math.min(selectedIndex, filtered.length - 1),
  );

  function clearOutline(): void {
    headings = [];
    activeKey = null;
    foldedKeys = new SvelteSet();
    publishedBinding = null;
  }

  /**
   * Sync `current` to `next` in place, adding/removing only the diff. A fresh
   * `SvelteSet` allocation on every poll invalidated every outline item's
   * `class:` and `aria-label` binding twice a second even when folds were
   * unchanged; mutating only on a real change keeps idle ticks cheap.
   */
  function applyFoldedKeys(current: SvelteSet<string>, next: readonly string[]): void {
    if (current.size !== next.length || next.some((k) => !current.has(k))) {
      current.clear();
      for (const k of next) {
        current.add(k);
      }
    }
  }

  function refreshFromHost(): void {
    if (disposed) {
      return;
    }
    const host = getHost();
    const expected = resolveOutlineHostBinding(host?.identity ?? null, documentId, paneId);
    if (!expected || !host) {
      clearOutline();
      return;
    }
    // One batched query: headings, active key and folded state all come from the same
    // editor state in a single pass. Reading them separately meant re-extracting the
    // whole outline once per heading, on every poll tick.
    const snapshot = host.queries.markdown.getOutlineSnapshot();
    // Re-read host after the query: ignore if tab/pane generation advanced mid-read.
    const stillActive = getHost();
    if (
      !stillActive ||
      !shouldPublishOutlineSnapshot(expected, stillActive.identity) ||
      !shouldPublishOutlineSnapshot(expected, host.identity)
    ) {
      return;
    }
    const nextHeadings = snapshot.ok ? snapshot.value.headings : [];
    const nextActive = snapshot.ok ? snapshot.value.activeKey : null;
    const nextFoldedKeys = snapshot.ok ? snapshot.value.foldedKeys : [];
    // Final generation check before mutating visible state.
    const publishHost = getHost();
    if (!publishHost || !shouldPublishOutlineSnapshot(expected, publishHost.identity)) {
      return;
    }
    headings = nextHeadings;
    activeKey = nextActive;
    // `headings` and `activeKey` keep referential equality on an idle tick, but
    // allocating a fresh `SvelteSet` here every 500 ms invalidated every item's
    // `class:`/`aria-label` binding for nothing. Mutate the existing set in
    // place only when its contents actually changed.
    applyFoldedKeys(foldedKeys, nextFoldedKeys);
    publishedBinding = expected;
  }

  function scheduleRefresh(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      // P03-08-23: skip work while the window is hidden (backgrounded tab,
      // minimized window). The poll re-arms on the next visible tick.
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      refreshFromHost();
    }, 80);
  }

  // Event-driven refresh on tab/document switch; poll remains a fallback for
  // cursor/fold updates within the same document (longer than the old 250ms).
  $effect(() => {
    void documentId;
    void paneId;
    clearOutline();
    refreshFromHost();
    let interval: ReturnType<typeof setInterval> | null = null;
    let visibilityHandler: (() => void) | null = null;
    // P03-08-23: only poll while the document is visible. The outline parse
    // runs on the main thread; polling a hidden window burned CPU for a panel
    // the user cannot see, and re-parsing on focus return is a single tick.
    const startPolling = (): void => {
      if (interval !== null) {
        return;
      }
      interval = setInterval(scheduleRefresh, 500);
    };
    const stopPolling = (): void => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };
    if (typeof document !== "undefined") {
      visibilityHandler = (): void => {
        if (document.hidden) {
          stopPolling();
        } else {
          // Refresh immediately on return to visible, then resume polling.
          refreshFromHost();
          startPolling();
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
      if (!document.hidden) {
        startPolling();
      }
    } else {
      startPolling();
    }
    return () => {
      if (visibilityHandler && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
      stopPolling();
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
  data-outline-document={documentId ?? ""}
  data-outline-generation={publishedBinding?.generation ?? ""}
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
