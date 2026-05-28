<script lang="ts">
  import ConsoleLogsPanel from "./ConsoleLogsPanel.svelte";
  import {
    DEFAULT_CONSOLE_HEIGHT_PX,
    MIN_CONSOLE_HEIGHT_PX,
    normalizeConsoleHeightPx,
  } from "../services/consoleTabPrefs";

  let {
    heightPx = $bindable(DEFAULT_CONSOLE_HEIGHT_PX),
    onHeightCommit,
  }: {
    heightPx?: number;
    onHeightCommit?: () => void;
  } = $props();

  let isResizing = $state(false);

  function clampHeight(next: number): number {
    return normalizeConsoleHeightPx(next);
  }

  function handleResizeStart(event: PointerEvent): void {
    event.preventDefault();
    isResizing = true;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const startHeight = heightPx;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const deltaY = startY - moveEvent.clientY;
      heightPx = clampHeight(startHeight + deltaY);
    };

    const onPointerEnd = (): void => {
      isResizing = false;
      target?.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      onHeightCommit?.();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
  }

  function handleResizeDoubleClick(): void {
    heightPx = DEFAULT_CONSOLE_HEIGHT_PX;
    onHeightCommit?.();
  }
</script>

<section
  class="console-panel"
  class:console-panel-resizing={isResizing}
  aria-hidden="false"
  style={`--console-height: ${heightPx}px;`}
>
  <div
    class="console-resize-handle"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize console panel"
    aria-valuemin={MIN_CONSOLE_HEIGHT_PX}
    aria-valuenow={heightPx}
    onpointerdown={handleResizeStart}
    ondblclick={handleResizeDoubleClick}
  ></div>

  <div class="console-content">
    <ConsoleLogsPanel />
  </div>
</section>

<style>
  .console-panel {
    position: relative;
    min-height: 0;
    height: var(--console-height);
    overflow: hidden;
    border-top: 1px solid var(--color-border-subtle);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    display: flex;
    flex-direction: column;
  }

  .console-panel-resizing {
    user-select: none;
  }

  .console-resize-handle {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: row-resize;
    touch-action: none;
    z-index: 2;
  }

  .console-content {
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }
</style>
