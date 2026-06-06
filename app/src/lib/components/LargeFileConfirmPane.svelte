<script lang="ts">
  interface Props {
    filePath?: string | null;
    title?: string;
    sizeBytes?: number;
    maxOpenWithoutConfirmBytes?: number;
    confirming?: boolean;
    onConfirm?: () => void | Promise<void>;
  }

  let {
    filePath = null,
    title = "Large file",
    sizeBytes = 0,
    maxOpenWithoutConfirmBytes = 0,
    confirming = false,
    onConfirm = () => {},
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
</script>

<div class="preview-panel large-file-preview">
  <div class="preview-title">{title}</div>
  <div class="large-file-preview-body">
    <p class="preview-message">
      This file is larger than the limit for opening without confirmation. Its contents were not
      loaded so tabs and close actions stay responsive.
    </p>
    <p class="preview-detail">File size: {formatSize(sizeBytes)}</p>
    <p class="preview-detail">Open limit: {formatSize(maxOpenWithoutConfirmBytes)}</p>
    {#if filePath}
      <p class="preview-path" title={filePath}>{filePath}</p>
    {/if}
    <button
      type="button"
      class="toolbar-button confirm-button"
      disabled={confirming}
      onclick={() => void onConfirm()}
    >
      {confirming ? "Opening…" : "Open file"}
    </button>
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

  .large-file-preview-body {
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

  .confirm-button {
    align-self: flex-start;
    margin-top: var(--space-8);
  }
</style>
