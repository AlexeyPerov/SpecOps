<script lang="ts">
  import type { MessageAttachment } from "../ai/chatAttachments";

  interface Props {
    attachment: MessageAttachment;
  }

  let { attachment }: Props = $props();

  /** Click-to-zoom: a full-viewport overlay with the full-resolution image. */
  let zoomed = $state(false);

  function openZoom(): void {
    zoomed = true;
  }

  function closeZoom(): void {
    zoomed = false;
  }

  /**
   * Overlay click handler: close only when the backdrop itself (not the image
   * or close button) is clicked. Checking the target avoids the previous
   * `<img onclick={stopPropagation}>` workaround, which tripped svelte-check's
   * "non-interactive element with click listener" / "click without keyboard"
   * a11y warnings.
   */
  function handleOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      closeZoom();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeZoom();
    }
  }

  /** Display name falls back to a generic label when no filename is set. */
  let displayName = $derived(attachment.filename ?? "Image");
</script>

<svelte:window onkeydown={zoomed ? handleKeydown : undefined} />

<figure class="image-attachment">
  <button
    type="button"
    class="image-attachment-thumb"
    onclick={openZoom}
    aria-label={`Open ${displayName} at full size`}
    title={displayName}
  >
    <img
      class="image-attachment-img"
      src={attachment.url}
      alt={displayName}
      loading="lazy"
      decoding="async"
    />
  </button>
  <figcaption class="image-attachment-caption">
    {#if attachment.filename}
      <span class="image-attachment-name">{attachment.filename}</span>
    {/if}
    <span class="image-attachment-zoom-hint">Click to zoom</span>
  </figcaption>
</figure>

{#if zoomed}
  <div
    class="image-attachment-overlay"
    role="dialog"
    aria-modal="true"
    aria-label={`${displayName} — full size`}
    tabindex="-1"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
  >
    <button
      type="button"
      class="image-attachment-close"
      onclick={closeZoom}
      aria-label="Close image"
    >
      ✕
    </button>
    <img
      class="image-attachment-full"
      src={attachment.url}
      alt={displayName}
    />
  </div>
{/if}

<style>
  .image-attachment {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: fit-content;
    max-width: 100%;
  }

  .image-attachment-thumb {
    padding: 0;
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    overflow: hidden;
    cursor: zoom-in;
    max-width: 100%;
    transition:
      border-color var(--motion-fast) var(--easing-standard),
      box-shadow var(--motion-fast) var(--easing-standard);
  }

  .image-attachment-thumb:hover {
    border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border-subtle));
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--color-accent) 14%, transparent);
  }

  .image-attachment-thumb:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  .image-attachment-img {
    display: block;
    max-width: 280px;
    max-height: 220px;
    width: auto;
    height: auto;
    object-fit: contain;
  }

  .image-attachment-caption {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: 10px;
    line-height: 1.4;
    color: var(--color-text-secondary);
  }

  .image-attachment-name {
    font-family: monospace;
    word-break: break-all;
    overflow-wrap: anywhere;
  }

  .image-attachment-zoom-hint {
    font-style: italic;
    opacity: 0.75;
    text-transform: lowercase;
  }

  .image-attachment-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: color-mix(in srgb, var(--color-surface-0, #000) 86%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-8);
    cursor: zoom-out;
    backdrop-filter: blur(2px);
  }

  .image-attachment-full {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: var(--radius-sm);
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
    cursor: default;
  }

  .image-attachment-close {
    position: absolute;
    top: var(--space-6);
    right: var(--space-6);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background-color var(--motion-fast) var(--easing-standard),
      border-color var(--motion-fast) var(--easing-standard);
  }

  .image-attachment-close:hover {
    background: color-mix(in srgb, var(--color-text-secondary) 12%, var(--color-surface-1));
    border-color: var(--color-text-secondary);
  }

  .image-attachment-close:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .image-attachment-thumb {
      transition: none;
    }
  }
</style>
