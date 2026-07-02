<script lang="ts">
  /**
   * Title bar. On macOS the native traffic lights sit in this region, so it's
   * a drag region with no window controls.
   */
</script>

<div class="title-bar" data-tauri-drag-region></div>

<style>
  .title-bar {
    position: relative;
    flex-shrink: 0;
    height: 32px;
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
    -webkit-app-region: drag;
  }
</style>
