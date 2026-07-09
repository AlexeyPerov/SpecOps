import type { Extension } from "@codemirror/state";
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
 * Returns the CodeMirror extension that drives the right-side minimap.
 *
 * When enabled, the facet returns {@link MINIMAP_CONFIG}; when disabled it
 * returns `null`, which the package treats as "no minimap" (see
 * `showMinimap.combine`). The same extension can live inside a `Compartment`
 * and be reconfigured with a new `enabled` value without remounting the editor.
 */
export function minimapExtension(enabled: boolean): Extension {
  // The config does not depend on editor state, so `[]` avoids recomputing it
  // on every document change. Returning `null` makes the package render no
  // minimap (see `showMinimap.combine`).
  return showMinimap.compute([], () => (enabled ? MINIMAP_CONFIG : null));
}
