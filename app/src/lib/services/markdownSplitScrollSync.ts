/**
 * Cancellable ratio-based scroll sync between a Markdown editor scroller and
 * its preview pane. Generation guards prevent stale setup from attaching after
 * rapid mode/document switches.
 */

export type MarkdownSplitScrollSyncHandle = {
  /** Tear down listeners; safe to call multiple times. */
  dispose: () => void;
};

export type MarkdownSplitScrollSyncOptions = {
  getEditorRoot: () => HTMLElement | null;
  getPreviewScroller: () => HTMLElement | null;
  /**
   * Wait for layout (e.g. Svelte `tick`) before querying scrollers.
   * Return early / throw to cancel; the setup generation is checked after.
   */
  waitForLayout?: () => Promise<void>;
};

function syncByRatio(source: HTMLElement, target: HTMLElement): void {
  const sourceScrollable = source.scrollHeight - source.clientHeight;
  const targetScrollable = target.scrollHeight - target.clientHeight;
  if (sourceScrollable <= 0 || targetScrollable <= 0) {
    if (target.scrollTop !== 0) {
      target.scrollTop = 0;
    }
    return;
  }
  const ratio = source.scrollTop / sourceScrollable;
  const nextScrollTop = Math.round(ratio * targetScrollable);
  if (Math.abs(target.scrollTop - nextScrollTop) <= 1) {
    return;
  }
  target.scrollTop = nextScrollTop;
}

/**
 * Start split-scroll sync. Call `dispose` when leaving split mode or unmounting.
 * Concurrent setups from older generations are ignored after `waitForLayout`.
 */
export function createMarkdownSplitScrollSync(
  options: MarkdownSplitScrollSyncOptions,
): MarkdownSplitScrollSyncHandle {
  let generation = 0;
  let cleanup: (() => void) | null = null;

  function dispose(): void {
    generation += 1;
    cleanup?.();
    cleanup = null;
  }

  async function setup(): Promise<void> {
    const setupGeneration = ++generation;
    cleanup?.();
    cleanup = null;

    if (options.waitForLayout) {
      await options.waitForLayout();
    }
    if (setupGeneration !== generation) {
      return;
    }

    const editorRoot = options.getEditorRoot();
    const previewScroller = options.getPreviewScroller();
    const editorScroller = editorRoot?.querySelector(".cm-scroller") as HTMLElement | null;
    if (!editorScroller || !previewScroller) {
      return;
    }

    const onEditorScroll = (event: Event): void => {
      if (!event.isTrusted) {
        return;
      }
      syncByRatio(editorScroller, previewScroller);
    };

    const onPreviewScroll = (event: Event): void => {
      if (!event.isTrusted) {
        return;
      }
      syncByRatio(previewScroller, editorScroller);
    };

    editorScroller.addEventListener("scroll", onEditorScroll, { passive: true });
    previewScroller.addEventListener("scroll", onPreviewScroll, { passive: true });
    syncByRatio(editorScroller, previewScroller);

    cleanup = () => {
      editorScroller.removeEventListener("scroll", onEditorScroll);
      previewScroller.removeEventListener("scroll", onPreviewScroll);
    };
  }

  void setup();

  return { dispose };
}

/** Pure helper exported for tests. */
export { syncByRatio as syncMarkdownSplitScrollByRatio };
