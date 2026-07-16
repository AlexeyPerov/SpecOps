<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { readFile } from "@tauri-apps/plugin-fs";
  import { mimeTypeForImagePath } from "../services/imagePreviewSrc";

  interface Props {
    filePath?: string | null;
    title?: string;
    sizeBytes?: number;
  }

  let { filePath = null, title = "Image", sizeBytes = 0 }: Props = $props();

  let blobObjectUrl = $state<string | null>(null);
  let loadFailed = $state(false);

  const tauriSrc = $derived(filePath ? convertFileSrc(filePath) : null);
  const resolvedSrc = $derived(blobObjectUrl ?? tauriSrc);

  $effect(() => {
    filePath;
    if (blobObjectUrl) {
      URL.revokeObjectURL(blobObjectUrl);
      blobObjectUrl = null;
    }
    loadFailed = false;
  });

  async function loadBlobFallback(): Promise<void> {
    const path = filePath;
    if (!path || blobObjectUrl) {
      return;
    }
    try {
      const bytes = await readFile(path);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: mimeTypeForImagePath(path) }),
      );
      blobObjectUrl = url;
      loadFailed = false;
    } catch {
      loadFailed = true;
    }
  }

  async function handleImageError(): Promise<void> {
    await loadBlobFallback();
  }

  function formatSize(bytes: number): string {
    if (bytes <= 0) {
      return "";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const sizeLabel = $derived(formatSize(sizeBytes));
</script>

<div class="preview-panel image-preview">
  <div class="preview-title">
    {title}{#if sizeLabel}
      · {sizeLabel}
    {/if}
  </div>
  <div class="image-preview-body">
    {#if resolvedSrc && !loadFailed}
      <img
        class="preview-image"
        src={resolvedSrc}
        alt={title}
        onerror={handleImageError}
      />
    {:else if loadFailed}
      <p class="preview-message">Could not load image preview.</p>
    {:else}
      <p class="preview-message">No file path available for image preview.</p>
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

  .image-preview-body {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-12);
    overflow: auto;
    background: var(--color-surface-0, var(--color-surface-1));
  }

  .preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-sm);
  }

  .preview-message {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-status);
  }
</style>
