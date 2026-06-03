<script lang="ts">
  interface Props {
    filePath?: string | null;
    title?: string;
    sizeBytes?: number;
    maxOpenAsTextBytes?: number;
  }

  let {
    filePath = null,
    title = "Binary file",
    sizeBytes = 0,
    maxOpenAsTextBytes = 0,
  }: Props = $props();

  function formatSize(bytes: number): string {
    if (bytes <= 0) {
      return "unknown size";
    }
    if (bytes < 1024) {
      return `${bytes} bytes`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const exceedsOpenAsTextLimit = $derived(
    maxOpenAsTextBytes > 0 && sizeBytes > maxOpenAsTextBytes,
  );
</script>

<div class="preview-panel binary-preview">
  <div class="preview-title">{title}</div>
  <div class="binary-preview-body">
    {#if exceedsOpenAsTextLimit}
      <p class="preview-message">
        This file looks binary and exceeds the size limit for opening as text. The editor did not
        load its contents so tabs and close actions stay responsive.
      </p>
      <p class="preview-detail">Open-as-text limit: {formatSize(maxOpenAsTextBytes)}</p>
      <p class="preview-detail">File size: {formatSize(sizeBytes)}</p>
    {:else}
      <p class="preview-message">
        This file looks binary. It was opened without loading the contents into the text editor, so
        tabs and close actions stay responsive.
      </p>
      <p class="preview-detail">Size: {formatSize(sizeBytes)}</p>
    {/if}
    {#if filePath}
      <p class="preview-path" title={filePath}>{filePath}</p>
    {/if}
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

  .binary-preview-body {
    flex: 1;
    min-height: 0;
    padding: var(--space-16);
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .preview-message,
  .preview-detail,
  .preview-path {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
    line-height: 1.5;
  }

  .preview-path {
    font-family: var(--font-family-mono, monospace);
    word-break: break-all;
  }
</style>
