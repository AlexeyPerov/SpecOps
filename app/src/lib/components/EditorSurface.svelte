<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { EditorLanguageId } from "../editor/editorLanguage";
  import { getEditorDocumentSessionCache } from "../editor/editorDocumentSessionContext";
  import {
    createEditorViewController,
    type EditorViewController,
  } from "../editor/editorViewController";
  import { getEditorWorkbenchRuntime } from "../editor/editorWorkbenchContext";
  import { logDiagnostic } from "../services/logging";
  import { startPointerDrag } from "./pointerDrag";
  import type { ContextId } from "../domain/contracts";
  import {
    MAX_TEXT_COLUMN_WIDTH_PX,
    MIN_TEXT_COLUMN_WIDTH_PX,
  } from "../domain/contracts";

  interface Props {
    content?: string;
    documentId?: string | null;
    paneId: string;
    /** Active context id — namespaces the editor host/session cache so contexts
     *  with overlapping pane/document ids do not collide when multiple editor
     *  trees stay mounted across a context switch. */
    contextId: ContextId;
    scrollTop?: number;
    wrapLines?: boolean;
    zoomPercent?: number;
    language?: EditorLanguageId;
    decoratePlaintextSymbols?: boolean;
    showMinimap?: boolean;
    showFoldGutter?: boolean;
    autoClosePairs?: boolean;
    autoSuggest?: boolean;
    enabledSnippets?: import("../domain/snippets").ResolvedMarkdownSnippet[];
    /**
     * Width of the centred text column in CSS px, or `null` for the app
     * default (`--editor-text-max-width`). The blank space between the gutter
     * and the text is what is left over, so this is what the edge handle
     * drags.
     */
    textColumnWidthPx?: number | null;
    /**
     * False while this surface lives in a keep-alive tab slot with
     * `display: none`. When it flips back to true, remasure so caret/gutters
     * recover after zero-size layout.
     */
    visible?: boolean;
    onStatusMessage?: (message: string) => void;
    onDocumentDirty?: (nextContent: string) => void;
    onScrollTopChange?: (documentId: string, scrollTop: number) => void;
    /** User-driven caret/selection move; promotes a transient tab. */
    onUserSelection?: (documentId: string) => void;
    /** Committed on pointer-up; `null` means "restore the default width". */
    onTextColumnWidthChange?: (documentId: string, widthPx: number | null) => void;
  }

  let {
    content = "",
    documentId = null,
    paneId,
    contextId,
    scrollTop = 0,
    wrapLines = false,
    zoomPercent = 100,
    language = "plaintext",
    decoratePlaintextSymbols = true,
    showMinimap = true,
    showFoldGutter = true,
    autoClosePairs = true,
    autoSuggest = false,
    enabledSnippets = [],
    textColumnWidthPx = null,
    visible = true,
    onStatusMessage = () => {},
    onDocumentDirty = () => {},
    onScrollTopChange = () => {},
    onUserSelection = () => {},
    onTextColumnWidthChange = () => {},
  }: Props = $props();

  const workbench = getEditorWorkbenchRuntime();
  const sessionCache = getEditorDocumentSessionCache();

  let hostEl = $state<HTMLDivElement | undefined>(undefined);
  /** Wrapper around the CodeMirror mount; owns the resize-handle overlay. */
  let hostFrameEl = $state<HTMLDivElement | undefined>(undefined);
  let controller: EditorViewController | undefined;

  onMount(() => {
    if (!hostEl) {
      return;
    }

    controller = createEditorViewController({
      workbench,
      sessionCache,
      onStatusMessage: (message) => onStatusMessage(message),
      onDocumentDirty: (nextContent) => onDocumentDirty(nextContent),
      onScrollTopChange: (id, nextScrollTop) => onScrollTopChange(id, nextScrollTop),
      onUserSelection: (id) => onUserSelection(id),
    });
    controller.update({
      content,
      documentId,
      paneId,
      contextId,
      scrollTop,
      wrapLines,
      zoomPercent,
      language,
      decoratePlaintextSymbols,
      showMinimap,
      showFoldGutter,
      autoClosePairs,
      autoSuggest,
      enabledSnippets,
    });
    controller.mount(hostEl);

    void logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "EditorSurface mounted",
      metadata: { documentId, paneId },
    });
  });

  onDestroy(() => {
    controller?.destroy();
    controller = undefined;

    void logDiagnostic({
      level: "debug",
      source: "frontend",
      timestamp: new Date().toISOString(),
      message: "EditorSurface destroyed",
      metadata: { documentId, paneId },
    });
  });

  $effect(() => {
    controller?.update({
      content,
      documentId,
      paneId,
      contextId,
      scrollTop,
      wrapLines,
      zoomPercent,
      language,
      decoratePlaintextSymbols,
      showMinimap,
      showFoldGutter,
      autoClosePairs,
      autoSuggest,
      enabledSnippets,
    });
  });

  // Keep-alive slots use display:none; CodeMirror's viewport/caret metrics go
  // stale at zero size. Remasure on the frame after becoming visible again.
  $effect(() => {
    if (!visible) {
      return;
    }
    const active = controller;
    if (!active) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      active.requestMeasure();
    });
    return () => cancelAnimationFrame(frame);
  });

  // ---------------------------------------------------------------------------
  // Text-column resize handle
  //
  // `.cm-content` is a centred column capped by `--editor-text-max-width`, so
  // the blank strip between the gutter and the first character is half of
  // whatever the pane has spare. The handle sits on that column's left edge:
  // pulling it out by a pixel widens the column by two (one per side), which is
  // the geometry the drag maths below assumes.
  // ---------------------------------------------------------------------------

  /** Half the handle's grab area; keep in step with the stylesheet. */
  const HANDLE_HALF_WIDTH_PX = 4;

  let pointerInside = $state(false);
  let isResizing = $state(false);
  /** Live width during a drag; synced from the prop when not dragging. */
  let displayWidthPx = $state<number | null>(null);
  /** Handle offset from the host's left edge, or null when it cannot be shown. */
  let handleLeftPx = $state<number | null>(null);
  let activeResizeTeardown: (() => void) | null = null;

  $effect(() => {
    const synced = textColumnWidthPx;
    if (!isResizing) {
      displayWidthPx = synced;
    }
  });

  // Bound to the frame, not the CodeMirror mount: the handle is a sibling of
  // the mount, so tracking the mount would fire `pointerleave` the moment the
  // pointer reached the handle and flicker it out of existence. Listeners
  // rather than markup handlers because a bare `<div>` with pointer handlers
  // trips the static-interaction a11y rule for what is purely a hover
  // affordance.
  $effect(() => {
    const frameEl = hostFrameEl;
    if (!frameEl) {
      return;
    }
    const enter = (): void => {
      pointerInside = true;
    };
    const leave = (): void => {
      pointerInside = false;
    };
    frameEl.addEventListener("pointerenter", enter);
    frameEl.addEventListener("pointerleave", leave);
    return () => {
      frameEl.removeEventListener("pointerenter", enter);
      frameEl.removeEventListener("pointerleave", leave);
    };
  });

  const hostStyle = $derived(
    displayWidthPx === null ? undefined : `--editor-text-max-width:${displayWidthPx}px`,
  );
  const handleVisible = $derived((pointerInside || isResizing) && handleLeftPx !== null);

  type ColumnGeometry = {
    /** Column's left edge, relative to the host. */
    left: number;
    /** Left edge of the space the column may occupy, relative to the host. */
    minLeft: number;
    width: number;
    /** Total inline space available to the column (column + both margins). */
    available: number;
  };

  function readColumnGeometry(): ColumnGeometry | null {
    const view = controller?.getView();
    if (!view || !hostEl) {
      return null;
    }
    const hostRect = hostEl.getBoundingClientRect();
    if (hostRect.width === 0) {
      return null;
    }
    const contentRect = view.contentDOM.getBoundingClientRect();
    // Gutters render before the content; `.cm-gutters-after` (e.g. the minimap
    // side) must not be mistaken for the left one.
    const gutters = view.dom.querySelector(".cm-gutters:not(.cm-gutters-after)");
    const gutterRight = gutters
      ? gutters.getBoundingClientRect().right
      : view.scrollDOM.getBoundingClientRect().left;
    const margin = Math.max(0, contentRect.left - gutterRight);
    return {
      left: contentRect.left - hostRect.left,
      minLeft: gutterRight - hostRect.left,
      width: contentRect.width,
      available: contentRect.width + margin * 2,
    };
  }

  function measureHandle(): void {
    if (!pointerInside && !isResizing) {
      handleLeftPx = null;
      return;
    }
    const geometry = readColumnGeometry();
    // Unwrapped long lines scroll the column under the sticky gutter; there is
    // nothing to grab once its edge is behind them.
    if (!geometry || geometry.left < geometry.minLeft) {
      handleLeftPx = null;
      return;
    }
    // At full width the column edge touches the gutter, and a hit area centred
    // on it would eat clicks on the line numbers. Nudge it clear.
    handleLeftPx = Math.max(geometry.left, geometry.minLeft + HANDLE_HALF_WIDTH_PX);
  }

  function clampWidth(value: number, available: number): number {
    const ceiling = Math.max(
      MIN_TEXT_COLUMN_WIDTH_PX,
      Math.min(MAX_TEXT_COLUMN_WIDTH_PX, Math.round(available)),
    );
    return Math.round(Math.min(ceiling, Math.max(MIN_TEXT_COLUMN_WIDTH_PX, value)));
  }

  function handleResizeStart(event: PointerEvent): void {
    const geometry = readColumnGeometry();
    if (!geometry || !documentId) {
      return;
    }
    event.preventDefault();
    activeResizeTeardown?.();

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = clampWidth(displayWidthPx ?? geometry.width, geometry.available);
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture(pointerId);
    isResizing = true;
    displayWidthPx = startWidth;

    const teardown = startPointerDrag({
      pointerId,
      target,
      onMove: (moveEvent) => {
        // Centred column: one pixel of pointer travel changes the width by two.
        const deltaX = moveEvent.clientX - startX;
        const nextWidth = clampWidth(startWidth - deltaX * 2, geometry.available);
        displayWidthPx = nextWidth;
        // Derived rather than measured: the ResizeObserver only reports the new
        // column a frame later, which would drag the rule behind the pointer.
        handleLeftPx = Math.max(
          geometry.minLeft + HANDLE_HALF_WIDTH_PX,
          geometry.minLeft + (geometry.available - nextWidth) / 2,
        );
      },
      onEnd: () => {
        isResizing = false;
        activeResizeTeardown = null;
        onTextColumnWidthChange(documentId, displayWidthPx);
        measureHandle();
      },
    });

    activeResizeTeardown = () => {
      isResizing = false;
      teardown();
    };
  }

  /** Double-click the handle to hand the column back to the app default. */
  function handleResizeReset(): void {
    if (!documentId) {
      return;
    }
    displayWidthPx = null;
    onTextColumnWidthChange(documentId, null);
    requestAnimationFrame(measureHandle);
  }

  // The handle only exists while the pointer is over the surface, so the
  // observers that keep it pinned to the column edge are scoped to that window.
  $effect(() => {
    if (!pointerInside && !isResizing) {
      return;
    }
    const view = controller?.getView();
    if (!view || !hostEl) {
      return;
    }
    let frame = 0;
    const schedule = (): void => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        measureHandle();
      });
    };
    measureHandle();
    const observer = new ResizeObserver(schedule);
    observer.observe(hostEl);
    observer.observe(view.contentDOM);
    view.scrollDOM.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
      view.scrollDOM.removeEventListener("scroll", schedule);
    };
  });

  onDestroy(() => {
    activeResizeTeardown?.();
    activeResizeTeardown = null;
  });
</script>

<div
  bind:this={hostFrameEl}
  class="editor-host"
  class:editor-host-resizing={isResizing}
  style={hostStyle}
>
  <div bind:this={hostEl} class="editor-mount"></div>
  {#if handleVisible}
    <div
      class="text-column-handle"
      class:text-column-handle-active={isResizing}
      style={`left:${handleLeftPx}px`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize text column"
      title="Drag to resize the text column — double-click to reset"
      onpointerdown={handleResizeStart}
      ondblclick={handleResizeReset}
    ></div>
  {/if}
</div>

<style>
  .editor-mount {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .editor-host {
    position: relative;
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-md);
    overflow: hidden;
    border: 1px solid var(--color-border-subtle);
  }

  /* Keep the resize cursor while the pointer outruns the handle mid-drag. */
  .editor-host-resizing {
    cursor: col-resize;
  }

  .text-column-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 9px;
    /* Centred on the column edge that `left` points at. */
    margin-left: -4px;
    cursor: col-resize;
    touch-action: none;
    /* CodeMirror gutters sit at z-index 200. */
    z-index: 300;
  }

  .text-column-handle::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 4px;
    width: 1px;
    background: var(--color-border-subtle);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .text-column-handle:hover::before,
  .text-column-handle-active::before {
    background: var(--color-accent);
    opacity: 1;
  }
</style>
