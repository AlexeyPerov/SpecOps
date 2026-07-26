import type { Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { showMinimap, type MinimapConfig } from "@replit/codemirror-minimap";

/**
 * Minimap container factory: returns a host `<div>` for the package to render
 * the scaled content + viewport overlay into. The overlay subtree handles
 * click/drag-to-scroll, so the host must stay pointer-interactive.
 */
function createMinimapHost(_view: EditorView): { dom: HTMLElement } {
  const dom = document.createElement("div");
  dom.className = "cm-minimap-host";
  dom.setAttribute("aria-hidden", "true");
  return { dom };
}

/** Shared config object returned by the minimap facet when enabled. */
const MINIMAP_CONFIG: MinimapConfig = {
  create: createMinimapHost,
  // "characters" gives the Sublime-style scaled-text look.
  displayText: "characters",
  // Keep the viewport indicator visible at rest (not only on hover).
  showOverlay: "always",
};

/**
 * Document size at which the minimap turns itself off.
 *
 * Painting is viewport-scoped, but the package's line-index `StateField` is not:
 * it rebuilds a per-line array for the *whole* document on every `docChanged`
 * (and on every fold change). That is unbounded per-keystroke work, so past
 * these limits the minimap costs more than it is worth and is disabled — which
 * short-circuits the recompute entirely, because the package skips the index
 * when its config is not enabled.
 *
 * Both limits are checked; either one trips. The character limit matches the
 * large-document threshold used by completion, and the line limit catches files
 * whose per-line cost dominates (many short lines).
 */
export const MINIMAP_MAX_DOC_CHARS = 500_000;
export const MINIMAP_MAX_DOC_LINES = 20_000;

/**
 * Whether a document is small enough for the minimap's whole-document line
 * index to be affordable. `length` and `lines` are both O(1) on `Text`, so this
 * is cheap enough to evaluate per transaction.
 *
 * Exported for unit testing.
 */
export function isMinimapAffordable(doc: Text): boolean {
  return doc.length <= MINIMAP_MAX_DOC_CHARS && doc.lines <= MINIMAP_MAX_DOC_LINES;
}

/**
 * Returning `null` from the facet makes the package render no minimap (see
 * `showMinimap.combine`). Both extensions are shared: they are plain values, and
 * the enabled one recomputes only a size comparison, so there is no reason to
 * allocate a fresh provider per editor state.
 */
const MINIMAP_DISABLED: Extension = showMinimap.compute([], () => null);
const MINIMAP_ENABLED: Extension = showMinimap.compute(["doc"], (state) =>
  isMinimapAffordable(state.doc) ? MINIMAP_CONFIG : null,
);

/**
 * Returns the CodeMirror extension that drives the right-side minimap.
 *
 * When enabled, the facet returns {@link MINIMAP_CONFIG} for documents within
 * the {@link MINIMAP_MAX_DOC_CHARS} / {@link MINIMAP_MAX_DOC_LINES} limits and
 * `null` above them; when disabled it always returns `null`. The same extension
 * can live inside a `Compartment` and be reconfigured with a new `enabled`
 * value without remounting the editor.
 *
 * The enabled provider depends on `"doc"` so crossing a limit (paste, delete,
 * external reload) takes effect immediately. The dependency is safe: the
 * callback only compares two integers, and returning the same config object
 * leaves the facet value untouched, so nothing downstream recomputes.
 */
export function minimapExtension(enabled: boolean): Extension {
  return enabled ? MINIMAP_ENABLED : MINIMAP_DISABLED;
}
