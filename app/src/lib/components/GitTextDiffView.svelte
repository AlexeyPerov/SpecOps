<script lang="ts">
  import type { DiffLine, ParsedTextDiff } from "../git/types";

  /**
   * D-02 — unified (single-pane) text diff viewer for commit file changes.
   * MVP: hunk headers, +/- styling, line numbers. Out of scope: word wrap
   * toggle, minimap, side-by-side view, syntax highlighting, external diff tool.
   */
  interface Props {
    diff: ParsedTextDiff | null;
    title?: string;
    loading?: boolean;
    error?: string | null;
  }

  let { diff = null, title, loading = false, error = null }: Props = $props();

  const displayTitle = $derived(title ?? diff?.path ?? "");
  const addedCount = $derived(diff?.addedLines ?? 0);
  const deletedCount = $derived(diff?.deletedLines ?? 0);
  const isBinary = $derived(diff?.isBinary ?? false);
  const hasNoHunks = $derived(
    diff !== null && !isBinary && diff.hunks.length === 0,
  );
  const ariaLabel = $derived(
    displayTitle ? `Diff for ${displayTitle}` : "File diff",
  );

  const allLines = $derived.by(() => {
    if (!diff) {
      return [] as DiffLine[];
    }
    return diff.hunks.flatMap((hunk) => hunk.lines);
  });

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
</script>

<div class="git-text-diff">
  <header class="git-text-diff-header">
    <p class="git-text-diff-title" title={displayTitle}>{displayTitle || "Diff"}</p>
    {#if diff && !isBinary && !hasNoHunks}
      <p class="git-text-diff-summary" aria-label="Line change summary">
        <span class="git-text-diff-added">+{addedCount}</span>
        <span class="git-text-diff-deleted">−{deletedCount}</span>
      </p>
    {/if}
  </header>

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
      <div class="git-text-diff-scroll">
        <div class="git-text-diff-table">
          {#each allLines as line, index (index)}
            <div class={`git-text-diff-row ${lineClass(line.kind)}`}>
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
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .git-text-diff {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-1);
  }

  .git-text-diff-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    min-height: 2.25rem;
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--color-border-subtle);
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
    color: #2d8a4e;
  }

  .git-text-diff-deleted {
    color: var(--color-danger, #c0392b);
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
    background: color-mix(in srgb, #2d8a4e 14%, transparent);
  }

  .git-text-diff-line-added .git-text-diff-content,
  .git-text-diff-line-added .git-text-diff-gutter,
  .git-text-diff-line-added .git-text-diff-prefix {
    color: #2d8a4e;
  }

  .git-text-diff-line-deleted {
    background: color-mix(in srgb, var(--color-danger, #c0392b) 14%, transparent);
  }

  .git-text-diff-line-deleted .git-text-diff-content,
  .git-text-diff-line-deleted .git-text-diff-gutter,
  .git-text-diff-line-deleted .git-text-diff-prefix {
    color: var(--color-danger, #c0392b);
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
