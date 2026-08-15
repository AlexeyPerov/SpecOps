<script lang="ts">
  import { fileDragActive } from "../services/fileDragOverlay";

  /**
   * Full-window highlight shown while an OS file drag hovers over the window.
   * Driven by the `onDragDropEvent` enter/over/leave lifecycle; purely
   * decorative, so it stays `pointer-events: none` and never interferes with
   * the drop itself.
   */
</script>

{#if $fileDragActive}
  <div class="file-drop-overlay" aria-hidden="true">
    <div class="file-drop-card">Drop to open files</div>
  </div>
{/if}

<style>
  .file-drop-overlay {
    position: fixed;
    inset: 0;
    z-index: 1150;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
    border: 2px dashed color-mix(in srgb, var(--color-accent) 55%, transparent);
    pointer-events: none;
  }

  .file-drop-card {
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-overlay);
    font-size: var(--font-size-ui);
    font-weight: 600;
    color: var(--color-text-primary);
  }
</style>
