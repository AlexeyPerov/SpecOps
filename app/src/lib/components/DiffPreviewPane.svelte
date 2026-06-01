<script lang="ts">
  import { diffLines } from "diff";

  export let savedContent = "";
  export let currentContent = "";

  $: diffRows = diffLines(savedContent, currentContent);
</script>

<div class="preview-panel diff-preview">
  <div class="preview-title">Diff Preview (saved vs current)</div>
  <div class="diff-grid">
    <div class="diff-column">
      <h4>Saved</h4>
      {#each diffRows as row}
        <pre class={`diff-row ${row.added ? "row-added" : row.removed ? "row-removed" : ""}`}>
{row.removed ? row.value : row.added ? "" : row.value}</pre>
      {/each}
    </div>
    <div class="diff-column">
      <h4>Current</h4>
      {#each diffRows as row}
        <pre class={`diff-row ${row.added ? "row-added" : row.removed ? "row-removed" : ""}`}>
{row.added ? row.value : row.removed ? "" : row.value}</pre>
      {/each}
    </div>
  </div>
</div>

<style>
  .preview-panel {
    height: 100%;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .preview-title {
    padding: var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: var(--font-size-status);
    color: var(--color-text-secondary);
  }

  .diff-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    height: 100%;
    padding: var(--space-8);
    overflow: auto;
  }

  .diff-column {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    overflow: auto;
  }

  .diff-column h4 {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border-bottom: 1px solid var(--color-border-subtle);
    font-size: var(--font-size-status);
  }

  .diff-row {
    margin: 0;
    padding: var(--space-2) var(--space-8);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .row-added {
    background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  .row-removed {
    background: color-mix(in srgb, #c53030 18%, transparent);
  }
</style>
