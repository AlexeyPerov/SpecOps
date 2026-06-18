<script lang="ts">
  import StatusPopover from "./StatusPopover.svelte";

  /**
   * Title bar. On macOS the native traffic lights sit in this region, so it's
   * a drag region with no window controls. M5-T4 adds a status button
   * (right-anchored) that opens the `StatusPopover` — only rendered when a
   * workspace is open and OpenCode is enabled.
   */
  interface Props {
    statusButtonVisible?: boolean;
    statusButtonActive?: boolean;
    statusWorkspaceRoot?: string | null;
    onToggleStatus?: () => void;
    onStatusClose?: () => void;
  }

  let {
    statusButtonVisible = false,
    statusButtonActive = false,
    statusWorkspaceRoot = null,
    onToggleStatus,
    onStatusClose,
  }: Props = $props();
</script>

<div class="title-bar" data-tauri-drag-region>
  {#if statusButtonVisible && statusWorkspaceRoot}
    <div class="title-bar-status-anchor">
      <button
        type="button"
        class="title-bar-status-button"
        class:title-bar-status-button-active={statusButtonActive}
        onclick={(event) => {
          event.stopPropagation();
          onToggleStatus?.();
        }}
        aria-haspopup="dialog"
        aria-expanded={statusButtonActive}
        title="Workspace status"
      >●</button>
      <StatusPopover
        workspaceRootPath={statusWorkspaceRoot}
        open={statusButtonActive}
        onClose={onStatusClose}
      />
    </div>
  {/if}
</div>

<style>
  .title-bar {
    position: relative;
    flex-shrink: 0;
    height: 32px;
    background: var(--color-surface-1);
    border-bottom: 1px solid var(--color-border-subtle);
    -webkit-app-region: drag;
  }

  .title-bar-status-anchor {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    -webkit-app-region: no-drag;
  }

  .title-bar-status-button {
    width: 28px;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .title-bar-status-button:hover {
    color: var(--color-accent);
  }

  .title-bar-status-button-active {
    color: var(--color-accent);
  }
</style>
