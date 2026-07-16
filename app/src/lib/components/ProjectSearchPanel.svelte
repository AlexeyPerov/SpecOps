<script lang="ts">
  import { tick } from "svelte";
  import {
    DEFAULT_CONSOLE_HEIGHT_PX,
    MIN_CONSOLE_HEIGHT_PX,
    normalizeConsoleHeightPx,
  } from "../services/consoleTabPrefs";
  import type { ProjectSearchResult } from "../services/projectSearch";

  interface Props {
    heightPx?: number;
    onHeightChange?: (heightPx: number) => void;
    onHeightCommit?: () => void;
    onClose?: () => void;
    query?: string;
    replaceValue?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    regex?: boolean;
    /** Inline regex validation error (empty string when the query is valid). */
    queryError?: string;
    results?: ProjectSearchResult[];
    running?: boolean;
    status?: string;
    /** Increments when an external caller wants the Find (or Replace) field focused. */
    focusNonce?: number;
    focusReplace?: boolean;
    onQueryChange?: (value: string) => void;
    onReplaceValueChange?: (value: string) => void;
    onCaseSensitiveChange?: (value: boolean) => void;
    onWholeWordChange?: (value: boolean) => void;
    onRegexChange?: (value: boolean) => void;
    onRunSearch?: () => void;
    onReplaceAll?: () => void;
    onOpenResult?: (path: string, line: number) => void;
  }

  let {
    heightPx = DEFAULT_CONSOLE_HEIGHT_PX,
    onHeightChange,
    onHeightCommit,
    onClose,
    query = "",
    replaceValue = "",
    caseSensitive = false,
    wholeWord = false,
    regex = false,
    queryError = "",
    results = [],
    running = false,
    status = "",
    focusNonce = 0,
    focusReplace = false,
    onQueryChange,
    onReplaceValueChange,
    onCaseSensitiveChange,
    onWholeWordChange,
    onRegexChange,
    onRunSearch,
    onReplaceAll,
    onOpenResult,
  }: Props = $props();

  let isResizing = $state(false);
  let collapsedFiles = $state<Set<string>>(new Set());
  let showReplace = $state(false);
  let findInputEl: HTMLInputElement | null = $state(null);
  let replaceInputEl: HTMLInputElement | null = $state(null);

  /** Navigation and replacement are disabled when the query is blank or invalid. */
  const canSearch = $derived(query.trim().length > 0 && !queryError);
  const canReplace = $derived(canSearch && results.length > 0);

  function clampHeight(next: number): number {
    return normalizeConsoleHeightPx(next);
  }

  function handleResizeStart(event: PointerEvent): void {
    event.preventDefault();
    isResizing = true;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = heightPx;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaY = startY - moveEvent.clientY;
      onHeightChange?.(clampHeight(startHeight + deltaY));
    };

    const onPointerEnd = (): void => {
      isResizing = false;
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      onHeightCommit?.();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  }

  function handleResizeDoubleClick(): void {
    onHeightChange?.(DEFAULT_CONSOLE_HEIGHT_PX);
    onHeightCommit?.();
  }

  function toggleFile(path: string): void {
    const next = new Set(collapsedFiles);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    collapsedFiles = next;
  }

  function isFileCollapsed(path: string): boolean {
    return collapsedFiles.has(path);
  }

  function totalMatches(): number {
    let total = 0;
    for (const result of results) {
      total += result.matches.length;
    }
    return total;
  }

  async function focusField(): Promise<void> {
    await tick();
    if (focusReplace && showReplace) {
      replaceInputEl?.focus();
      replaceInputEl?.select();
    } else {
      findInputEl?.focus();
      findInputEl?.select();
    }
  }

  // Re-focus when an opener asks for it (e.g. Cmd+Shift+R should land in Replace).
  $effect(() => {
    if (focusNonce > 0) {
      if (focusReplace) {
        showReplace = true;
      }
      void focusField();
    }
  });

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (canSearch) {
        onRunSearch?.();
      }
    }
  }
</script>

<section
  class="project-search-panel"
  class:project-search-panel-resizing={isResizing}
  aria-label="Find in Project"
  style={`--panel-height: ${heightPx}px;`}
>
  <div
    class="panel-resize-handle"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize find-in-project panel"
    aria-valuemin={MIN_CONSOLE_HEIGHT_PX}
    aria-valuenow={heightPx}
    onpointerdown={handleResizeStart}
    ondblclick={handleResizeDoubleClick}
  ></div>

  <div class="ps-body">
    <div class="ps-form" role="group" aria-label="Search">
      <div class="ps-row">
        <button
          type="button"
          class="ps-chevron"
          title={showReplace ? "Hide replace" : "Show replace"}
          onclick={() => (showReplace = !showReplace)}
        >
          {showReplace ? "▾" : "▸"}
        </button>
        <input
          bind:this={findInputEl}
          type="text"
          class="ps-input"
          class:ps-input-error={Boolean(queryError)}
          placeholder="Search in project…"
          value={query}
          oninput={(e) => onQueryChange?.((e.currentTarget as HTMLInputElement).value)}
          onkeydown={handleKeydown}
          aria-invalid={Boolean(queryError)}
          aria-label="Search in project"
        />
        <button
          type="button"
          class="search-control-btn"
          class:search-control-btn-active={caseSensitive}
          title="Match case"
          aria-pressed={caseSensitive}
          onclick={() => onCaseSensitiveChange?.(!caseSensitive)}
        >
          Aa
        </button>
        <button
          type="button"
          class="search-control-btn"
          class:search-control-btn-active={wholeWord}
          title="Whole word"
          aria-pressed={wholeWord}
          onclick={() => onWholeWordChange?.(!wholeWord)}
        >
          W
        </button>
        <button
          type="button"
          class="search-control-btn"
          class:search-control-btn-active={regex}
          title="Regular expression"
          aria-pressed={regex}
          onclick={() => onRegexChange?.(!regex)}
        >
          .*
        </button>
        <button
          type="button"
          class="search-control-btn search-control-btn-primary"
          disabled={running || !canSearch}
          title="Search (Enter)"
          onclick={() => onRunSearch?.()}
        >
          {running ? "…" : "Search"}
        </button>
        <button
          type="button"
          class="search-control-btn"
          title="Close (Escape)"
          onclick={() => onClose?.()}
        >
          &times;
        </button>
      </div>
      {#if showReplace}
        <div class="ps-row">
          <div class="ps-chevron-spacer"></div>
          <input
            bind:this={replaceInputEl}
            type="text"
            class="ps-input"
            placeholder="Replace…"
            value={replaceValue}
            oninput={(e) =>
              onReplaceValueChange?.((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="search-control-btn search-control-btn-wide"
            disabled={running || !canReplace}
            title="Replace all matches across the workspace"
            onclick={() => onReplaceAll?.()}
          >
            Replace All
          </button>
        </div>
      {/if}
    </div>

    {#if queryError}
      <div class="ps-query-error" role="alert">{queryError}</div>
    {/if}

    <div class="ps-status">{status}</div>

    <div class="ps-results" role="list">
      {#each results as result (result.path)}
        {@const collapsed = isFileCollapsed(result.path)}
        <div class="ps-file" role="listitem">
          <button
            type="button"
            class="ps-file-toggle"
            title={collapsed ? "Expand" : "Collapse"}
            onclick={() => toggleFile(result.path)}
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <span class="ps-file-path" title={result.path}>{result.path}</span>
          <span class="ps-file-count">{result.matches.length}</span>
        </div>
        {#if !collapsed}
          <ul class="ps-matches">
            {#each result.matches as match (match.from)}
              <li>
                <button
                  type="button"
                  class="ps-match"
                  title="Open at this match"
                  onclick={() => onOpenResult?.(result.path, match.line)}
                >
                  <span class="ps-match-line">L{match.line}:{match.column}</span>
                  <span class="ps-match-text">{match.lineText.trim()}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <div class="ps-empty">
          {running ? "Searching…" : status ? "" : "No results yet — enter a query and press Enter."}
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .project-search-panel {
    position: relative;
    min-height: 0;
    height: var(--panel-height);
    overflow: hidden;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
  }

  .project-search-panel-resizing {
    user-select: none;
  }

  .panel-resize-handle {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: row-resize;
    touch-action: none;
    z-index: 2;
  }

  .ps-body {
    min-height: 0;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: var(--space-4) var(--space-8);
    gap: var(--space-4);
  }

  .ps-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    flex-shrink: 0;
  }

  .ps-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .ps-chevron,
  .ps-chevron-spacer {
    width: 20px;
    flex-shrink: 0;
  }

  .ps-chevron {
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
    padding: 0;
  }

  .ps-chevron:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .ps-input {
    flex: 1 1 240px;
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

  .ps-input:focus {
    border-color: var(--color-accent);
  }

  .ps-input-error {
    border-color: var(--color-danger, var(--color-accent));
  }

  .ps-query-error {
    flex-shrink: 0;
    font-size: var(--font-size-status);
    color: var(--color-danger, var(--color-accent));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Search controls use the shared .search-control-btn vocabulary (U3.1). */

  .ps-status {
    flex-shrink: 0;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .ps-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .ps-empty {
    padding: var(--space-4) 0;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .ps-file {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  .ps-file-toggle {
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    font-size: 10px;
    padding: 0;
    flex-shrink: 0;
  }

  .ps-file-toggle:hover {
    color: var(--color-text-primary);
  }

  .ps-file-path {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-status);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }

  .ps-file-count {
    flex-shrink: 0;
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .ps-matches {
    list-style: none;
    margin: 0 0 var(--space-2) calc(16px + var(--space-3));
    padding: 0;
  }

  .ps-match {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    text-align: left;
    font: inherit;
    font-size: var(--font-size-status);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .ps-match:hover {
    background: var(--color-hover);
    color: var(--color-text-primary);
  }

  .ps-match-line {
    flex-shrink: 0;
    color: var(--color-accent);
    font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }

  .ps-match-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
</style>
