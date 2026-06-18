<script lang="ts">
  import type { ComposerAttachment } from "../ai/composerContext";

  /**
   * Composer attachment tray (M3-T3). Shows pending file attachments as chips
   * above the textarea (with image thumbnails when the attachment is an
   * image). Provides a file-picker button and accepts drag-and-drop. The
   * parent owns the attachment list; this component renders it and emits
   * `onAddFiles` / `onRemove`.
   */
  interface Props {
    attachments: ComposerAttachment[];
    disabled?: boolean;
    onAddFiles: (files: File[]) => void;
    onRemove: (attachmentId: string) => void;
  }

  let {
    attachments,
    disabled = false,
    onAddFiles,
    onRemove,
  }: Props = $props();

  let fileInputEl: HTMLInputElement | null = null;
  let dragOver = $state(false);

  function openPicker(): void {
    fileInputEl?.click();
  }

  function handleFileInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = target.files ? Array.from(target.files) : [];
    if (files.length > 0) {
      onAddFiles(files);
    }
    // Reset so the same file can be picked again after removal.
    target.value = "";
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragOver = false;
    if (disabled) {
      return;
    }
    const files = event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : [];
    if (files.length > 0) {
      onAddFiles(files);
    }
  }

  function handleDragOver(event: DragEvent): void {
    if (disabled) {
      return;
    }
    event.preventDefault();
    if (!dragOver) {
      dragOver = true;
    }
  }

  function handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragOver = false;
  }

  function formatSize(bytes: number | undefined): string {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
      return "";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
</script>

<div
  class={`attachment-tray${dragOver ? " is-drag-over" : ""}`}
  role="group"
  aria-label="Attachments"
  ondrop={handleDrop}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
>
  {#if attachments.length > 0}
    <ul class="attachment-tray-list" role="presentation">
      {#each attachments as attachment (attachment.id)}
        <li class="attachment-chip" title={attachment.filename}>
          {#if attachment.isImage}
            <img
              class="attachment-chip-thumb"
              src={attachment.url}
              alt=""
              loading="lazy"
              aria-hidden="true"
            />
          {:else}
            <span class="attachment-chip-icon" aria-hidden="true">📎</span>
          {/if}
          <span class="attachment-chip-meta">
            <span class="attachment-chip-name">{attachment.filename}</span>
            {#if attachment.sizeBytes !== undefined}
              <span class="attachment-chip-size">{formatSize(attachment.sizeBytes)}</span>
            {/if}
          </span>
          <button
            type="button"
            class="attachment-chip-remove"
            aria-label={`Remove ${attachment.filename}`}
            onclick={() => onRemove(attachment.id)}
            disabled={disabled}
          >
            ✕
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <button
    type="button"
    class="attachment-tray-add"
    onclick={openPicker}
    disabled={disabled}
    title="Attach files"
  >
    <span aria-hidden="true">📎</span>
    <span>Attach</span>
  </button>
  <input
    bind:this={fileInputEl}
    class="attachment-tray-input"
    type="file"
    multiple
    aria-hidden="true"
    tabindex={-1}
    onchange={handleFileInputChange}
    disabled={disabled}
  />
</div>

<style>
  .attachment-tray {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px dashed var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    transition: border-color var(--motion-fast) var(--easing-standard);
  }

  .attachment-tray.is-drag-over {
    border-color: color-mix(in srgb, var(--color-accent) 60%, var(--color-border-subtle));
    background: color-mix(in srgb, var(--color-accent) 6%, var(--color-surface-1));
  }

  .attachment-tray-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: contents;
  }

  .attachment-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-text-secondary) 5%, transparent);
    color: var(--color-text-primary);
    font-size: 11px;
    line-height: 1.3;
    max-width: 220px;
  }

  .attachment-chip-thumb {
    width: 24px;
    height: 24px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .attachment-chip-icon {
    font-size: 14px;
    line-height: 1;
    flex-shrink: 0;
  }

  .attachment-chip-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .attachment-chip-name {
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }

  .attachment-chip-size {
    color: var(--color-text-secondary);
    font-size: 10px;
  }

  .attachment-chip-remove {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
  }

  .attachment-chip-remove:hover:not(:disabled) {
    background: color-mix(in srgb, #e06c75 22%, transparent);
    color: var(--color-text-primary);
  }

  .attachment-chip-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .attachment-tray-add {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 11px;
    line-height: 1.3;
    cursor: pointer;
  }

  .attachment-tray-add:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: color-mix(in srgb, var(--color-accent) 32%, var(--color-border-subtle));
  }

  .attachment-tray-add:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .attachment-tray-input {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .attachment-tray {
      transition: none;
    }
  }
</style>
