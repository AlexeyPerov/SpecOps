<script lang="ts">
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
</script>

{#if isMac}
  <div class="title-bar" data-tauri-drag-region></div>
{/if}

<style>
  .title-bar {
    flex-shrink: 0;
    height: 32px;
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
    -webkit-app-region: drag;
  }
</style>
