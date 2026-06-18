<script lang="ts">
  import type { DiffRow } from "../ai/chatDiffParser";

  /**
   * M5-T2 — renders the parsed rows of a single file's unified-diff patch as
   * a side-by-side gutter: old line number | new line number | line. Added
   * rows are tinted green, removed rows red, hunk headers dimmed. Pure
   * presentation — the parent owns parsing + selection.
   */
  interface Props {
    rows: DiffRow[];
    view?: "unified" | "split";
  }

  let { rows, view = "unified" }: Props = $props();

  function formatLine(value: number | null): string {
    return value === null ? "" : String(value);
  }

  /**
   * Splits unified rows into parallel left (removed/context) and right
   * (added/context) columns for side-by-side view. Context lines appear on
   * both sides; removed lines only on the left; added lines only on the
   * right. Padding rows keep the columns aligned.
   */
  function splitRows(rows: DiffRow[]): { left: DiffRow[]; right: DiffRow[] } {
    const left: DiffRow[] = [];
    const right: DiffRow[] = [];
    const blank: DiffRow = {
      kind: "context",
      text: "",
      oldLineNumber: null,
      newLineNumber: null,
    };
    for (const row of rows) {
      if (row.kind === "removed") {
        left.push(row);
        right.push(blank);
      } else if (row.kind === "added") {
        left.push(blank);
        right.push(row);
      } else {
        // context / hunk / meta appear on both sides to keep alignment.
        left.push(row);
        right.push(row);
      }
    }
    return { left, right };
  }

  const split = $derived(view === "split" ? splitRows(rows) : null);
</script>

{#if split}
  <div class="diff-view diff-view-split" role="table">
    <div class="diff-split-column" aria-label="Removed lines">
      {#each split.left as row, index (index)}
        <div class={`diff-line diff-line-${row.kind}`}>
          <span class="diff-gutter">{formatLine(row.oldLineNumber)}</span>
          <pre class="diff-text">{row.text}</pre>
        </div>
      {/each}
    </div>
    <div class="diff-split-column" aria-label="Added lines">
      {#each split.right as row, index (index)}
        <div class={`diff-line diff-line-${row.kind}`}>
          <span class="diff-gutter">{formatLine(row.newLineNumber)}</span>
          <pre class="diff-text">{row.text}</pre>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div class="diff-view diff-view-unified" role="table">
    {#each rows as row, index (index)}
      <div class={`diff-line diff-line-${row.kind}`}>
        <span class="diff-gutter diff-gutter-old">{formatLine(row.oldLineNumber)}</span>
        <span class="diff-gutter diff-gutter-new">{formatLine(row.newLineNumber)}</span>
        <pre class="diff-text">{row.text}</pre>
      </div>
    {/each}
  </div>
{/if}

<style>
  .diff-view {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
    width: 100%;
  }

  .diff-view-unified {
    display: flex;
    flex-direction: column;
  }

  .diff-view-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .diff-split-column {
    min-width: 0;
    overflow-x: auto;
    display: flex;
    flex-direction: column;
  }

  .diff-split-column:first-child {
    border-right: 1px solid var(--color-border-subtle);
  }

  .diff-line {
    display: flex;
    align-items: flex-start;
    min-width: 0;
  }

  .diff-gutter {
    flex-shrink: 0;
    min-width: 3ch;
    padding: 0 var(--space-2);
    text-align: right;
    color: var(--color-text-secondary);
    opacity: 0.7;
    user-select: none;
    white-space: nowrap;
  }

  .diff-text {
    margin: 0;
    padding: 0 var(--space-4);
    white-space: pre;
    overflow-x: hidden;
    flex: 1;
    min-width: 0;
  }

  .diff-line-context .diff-text {
    color: var(--color-text-primary);
  }

  .diff-line-added {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  }

  .diff-line-added .diff-text,
  .diff-line-added .diff-gutter {
    color: var(--color-accent);
  }

  .diff-line-removed {
    background: color-mix(in srgb, #e06c75 14%, transparent);
  }

  .diff-line-removed .diff-text,
  .diff-line-removed .diff-gutter {
    color: #e06c75;
  }

  .diff-line-hunk {
    color: var(--color-text-secondary);
    background: var(--color-hover);
  }

  .diff-line-hunk .diff-text {
    font-weight: 600;
  }

  .diff-line-meta .diff-text {
    color: var(--color-text-secondary);
    opacity: 0.6;
  }
</style>
