<script lang="ts">
  import { untrack } from "svelte";
  import type { DiffLine, ParsedTextDiff } from "../git/types";

  /**
   * D-02 — unified (single-pane) text diff viewer for commit file changes.
   * MVP: hunk headers, +/- styling, line numbers. Out of scope: word wrap
   * toggle, minimap, side-by-side view, syntax highlighting, external diff tool.
   */
  interface Props {
    diff: ParsedTextDiff | null;
    title?: string;
    subtitle?: string;
    subtitleHelp?: string;
    loading?: boolean;
    error?: string | null;
  }

  let { diff = null, title, subtitle, subtitleHelp, loading = false, error = null }: Props = $props();

  const displayTitle = $derived(title ?? diff?.path ?? "");
  const displaySubtitle = $derived(subtitle ?? "");
  const addedCount = $derived(diff?.addedLines ?? 0);
  const deletedCount = $derived(diff?.deletedLines ?? 0);
  const isBinary = $derived(diff?.isBinary ?? false);
  const hasNoHunks = $derived(
    diff !== null && !isBinary && diff.hunks.length === 0,
  );
  const ariaLabel = $derived(
    displayTitle ? `Diff for ${displayTitle}` : "File diff",
  );

  let search = $state("");
  let matchIndex = $state(0);
  let actionError = $state<string | null>(null);


  function moveMatch(direction: number) {
    if (!matches.length || !diffScrollEl) return;
    matchIndex = (matchIndex + direction + matches.length) % matches.length;
    diffScrollTop = matches[matchIndex] * DIFF_ROW_PITCH;
    diffScrollEl.scrollTop = diffScrollTop;
  }
  function changeSearch(value: string) {
    search = value;
    matchIndex = 0;
    moveMatch(0);
  }
  async function copy(value: string) {
    actionError = null;
    try { await navigator.clipboard.writeText(value); }
    catch { actionError = "Could not copy to clipboard"; }
  }
  $effect(() => {
    const current = diff;
    const path = title;
    untrack(() => {
      search = "";
      matchIndex = 0;
      actionError = null;
      diffScrollTop = 0;
      if (diffScrollEl) diffScrollEl.scrollTop = 0;
    });
  });

  const allLines = $derived.by(() => {
    if (!diff) {
      return [] as DiffLine[];
    }
    return diff.hunks.flatMap((hunk) => hunk.lines);
  });

  const matches = $derived(search.trim() ? allLines.flatMap((line, index) =>
    line.content.toLowerCase().includes(search.toLowerCase()) ? [index] : []) : []);

  // Windowing for large diffs. Each row is a single unwrapped line
  // (`white-space: pre`, `line-height: 1.5` at 12px → 18px), so the pitch is
  // fixed and the window math is exact. Without this a ~10k-row diff rendered
  // every row (×4 elements) and stalled the panel (M13).
  const DIFF_ROW_PITCH = 18;
  const DIFF_VIRTUALIZE_THRESHOLD = 400;
  const DIFF_OVERSCAN_ROWS = 20;

  let diffScrollEl = $state<HTMLDivElement | null>(null);
  let diffScrollTop = $state(0);
  let diffViewportHeight = $state(0);

  const diffVisibleRange = $derived.by(() => {
    const total = allLines.length;
    if (total <= DIFF_VIRTUALIZE_THRESHOLD || diffViewportHeight <= 0) {
      return { start: 0, end: total };
    }
    const start = Math.max(0, Math.floor(diffScrollTop / DIFF_ROW_PITCH) - DIFF_OVERSCAN_ROWS);
    const end = Math.min(
      total,
      Math.ceil((diffScrollTop + diffViewportHeight) / DIFF_ROW_PITCH) + DIFF_OVERSCAN_ROWS,
    );
    return { start, end };
  });
  const diffTopPadPx = $derived(
    diffVisibleRange.start === 0 ? 0 : diffVisibleRange.start * DIFF_ROW_PITCH,
  );
  const diffBottomPadPx = $derived(
    Math.max(0, (allLines.length - diffVisibleRange.end) * DIFF_ROW_PITCH),
  );

  function formatLineNo(value: number | undefined): string {
    return value === undefined ? "" : String(value);
  }

  function linePrefix(kind: DiffLine["kind"]): string {
    switch (kind) {
      case "added":
        return "+";
      case "deleted":
        return "-";
      case "context":
        return " ";
      default:
        return "";
    }
  }

  function lineClass(kind: DiffLine["kind"]): string {
    switch (kind) {
      case "added":
        return "git-text-diff-line-added";
      case "deleted":
        return "git-text-diff-line-deleted";
      case "hunk-header":
        return "git-text-diff-line-hunk";
      case "meta":
        return "git-text-diff-line-meta";
      default:
        return "git-text-diff-line-context";
    }
  }

  $effect(() => {
    const el = diffScrollEl;
    if (!el || typeof window === "undefined") {
      return;
    }
    const measure = (): void => {
      diffViewportHeight = el.clientHeight;
    };
    const onScroll = (): void => {
      diffScrollTop = el.scrollTop;
    };
    measure();
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(el);
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
    };
  });
</script>

<div class="git-text-diff">
  <header class="git-text-diff-header">
    <div class="git-text-diff-heading">
      <p class="git-text-diff-title" title={displayTitle}>{displayTitle || "Diff"}</p>
      {#if displaySubtitle}
        <p class="git-text-diff-subtitle" title={subtitleHelp}>{displaySubtitle}</p>
      {/if}
    </div>
    {#if diff && !isBinary && !hasNoHunks}
      <p class="git-text-diff-summary" aria-label="Line change summary">
        <span class="git-text-diff-added">+{addedCount}</span>
        <span class="git-text-diff-deleted">−{deletedCount}</span>
      </p>
    {/if}
    <details class="diff-actions">
      <summary aria-label="Diff actions">Actions</summary>
      <div class="diff-action-menu">
        <button type="button" disabled={!displayTitle} onclick={() => void copy(displayTitle)}>Copy path</button>
        <button type="button" disabled={!diff || loading || !!error || isBinary || hasNoHunks}
          onclick={() => void copy(allLines.map(line => linePrefix(line.kind) + line.content).join("\n"))}>Copy displayed diff</button>
      </div>
    </details>
  </header>
  {#if diff && !loading && !error && !isBinary && !hasNoHunks}
    <div class="diff-search">
      <input aria-label="Search displayed diff" placeholder="Search diff" value={search}
        oninput={event => changeSearch(event.currentTarget.value)}
        onkeydown={event => { if (event.key === "Enter") { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); } }} />
      <span role="status">{matches.length ? matchIndex + 1 : 0}/{matches.length}</span>
      <button type="button" aria-label="Previous diff match" disabled={!matches.length} onclick={() => moveMatch(-1)}>↑</button>
      <button type="button" aria-label="Next diff match" disabled={!matches.length} onclick={() => moveMatch(1)}>↓</button>
    </div>
  {/if}
  {#if actionError}<p role="alert">{actionError}</p>{/if}

  <div
    class="git-text-diff-body"
    role="region"
    aria-label={ariaLabel}
    aria-busy={loading}
  >
    {#if loading}
      <div class="git-text-diff-state" role="status" aria-live="polite">
        <p class="git-text-diff-state-title">Loading diff…</p>
      </div>
    {:else if error}
      <div class="git-text-diff-state" role="alert">
        <p class="git-text-diff-state-title">Could not load diff</p>
        <p class="git-text-diff-state-detail">{error}</p>
      </div>
    {:else if !diff}
      <div class="git-text-diff-state" role="status">
        <p class="git-text-diff-state-title">Select a file to view changes</p>
      </div>
    {:else if isBinary}
      <div class="git-text-diff-state" role="status">
        <p class="git-text-diff-state-title">Binary file — diff not shown</p>
      </div>
    {:else if hasNoHunks}
      <div class="git-text-diff-state" role="status">
        <p class="git-text-diff-state-title">No diff content</p>
      </div>
    {:else}
      <div class="git-text-diff-scroll" bind:this={diffScrollEl}>
        <div class="git-text-diff-table">
          {#if diffTopPadPx > 0}
            <div class="git-text-diff-spacer" style="height: {diffTopPadPx}px" aria-hidden="true"></div>
          {/if}
          {#each allLines.slice(diffVisibleRange.start, diffVisibleRange.end) as line, i (diffVisibleRange.start + i)}
            <div class={`git-text-diff-row ${lineClass(line.kind)}`} class:diff-search-match={matches.includes(diffVisibleRange.start + i)} class:diff-search-current={matches[matchIndex] === diffVisibleRange.start + i}>
              <span class="git-text-diff-gutter git-text-diff-gutter-old">
                {formatLineNo(line.oldLineNo)}
              </span>
              <span class="git-text-diff-gutter git-text-diff-gutter-new">
                {formatLineNo(line.newLineNo)}
              </span>
              <span class="git-text-diff-prefix">{linePrefix(line.kind)}</span>
              <pre class="git-text-diff-content">{line.content}</pre>
            </div>
          {/each}
          {#if diffBottomPadPx > 0}
            <div class="git-text-diff-spacer" style="height: {diffBottomPadPx}px" aria-hidden="true"></div>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .diff-search { display: flex; flex-shrink: 0; align-items: center; gap: 4px; padding: 4px 8px; font-size: 12px; }
  .diff-search input { min-width: 50px; flex: 1; }
  .diff-search input, button { background: var(--color-surface-2); border: 1px solid var(--color-border-subtle); color: var(--color-text); font: inherit; }
  .diff-actions { position: relative; font-size: 12px; }
  .diff-actions summary { cursor: pointer; }
  .diff-action-menu { position: absolute; right: 0; z-index: 2; display: flex; flex-direction: column; background: var(--color-surface-2); min-width: 150px; padding: 4px; }
  .diff-search-match .git-text-diff-content { text-decoration: underline; text-decoration-color: var(--color-accent); }
  .diff-search-current { outline: 1px solid var(--color-accent); outline-offset: -1px; }

  .git-text-diff {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .git-text-diff-header {
    flex-shrink: 0;
    flex-wrap: wrap;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 2.25rem;
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .git-text-diff-heading {
    flex: 1 1 8rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .git-text-diff-title {
    margin: 0;
    min-width: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .git-text-diff-subtitle {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .git-text-diff-summary {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0;
    flex-shrink: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .git-text-diff-added {
    color: var(--color-diff-added);
  }

  .git-text-diff-deleted {
    color: var(--color-danger);
  }

  .git-text-diff-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .git-text-diff-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-10) var(--space-8);
    color: var(--color-text-secondary);
    text-align: center;
  }

  .git-text-diff-state-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .git-text-diff-state-detail {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .git-text-diff-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .git-text-diff-table {
    display: flex;
    flex-direction: column;
    min-width: 100%;
    width: max-content;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
  }

  .git-text-diff-row {
    display: flex;
    align-items: flex-start;
    min-width: 0;
  }

  .git-text-diff-spacer {
    width: 100%;
  }

  .git-text-diff-gutter {
    flex-shrink: 0;
    min-width: 3.5ch;
    padding: 0 var(--space-2);
    text-align: right;
    color: var(--color-text-secondary);
    opacity: 0.7;
    user-select: none;
    white-space: nowrap;
  }

  .git-text-diff-prefix {
    flex-shrink: 0;
    width: 1.25ch;
    padding: 0 var(--space-1);
    text-align: center;
    user-select: none;
    color: var(--color-text-secondary);
  }

  .git-text-diff-content {
    margin: 0;
    padding: 0 var(--space-4) 0 0;
    white-space: pre;
    flex: 1;
    min-width: 0;
  }

  .git-text-diff-line-context .git-text-diff-content {
    color: var(--color-text);
  }

  .git-text-diff-line-added {
    background: color-mix(in srgb, var(--color-diff-added) 14%, transparent);
  }

  .git-text-diff-line-added .git-text-diff-content,
  .git-text-diff-line-added .git-text-diff-gutter,
  .git-text-diff-line-added .git-text-diff-prefix {
    color: var(--color-diff-added);
  }

  .git-text-diff-line-deleted {
    background: color-mix(in srgb, var(--color-danger) 14%, transparent);
  }

  .git-text-diff-line-deleted .git-text-diff-content,
  .git-text-diff-line-deleted .git-text-diff-gutter,
  .git-text-diff-line-deleted .git-text-diff-prefix {
    color: var(--color-danger);
  }

  .git-text-diff-line-hunk {
    background: var(--color-hover);
    color: var(--color-text-secondary);
  }

  .git-text-diff-line-hunk .git-text-diff-content {
    font-weight: 600;
  }

  .git-text-diff-line-meta .git-text-diff-content {
    color: var(--color-text-secondary);
    opacity: 0.75;
    font-style: italic;
  }
</style>
