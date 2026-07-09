import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { showMinimap, type MinimapConfig } from "@replit/codemirror-minimap";

/**
 * Minimap container factory: returns a host `<div>` for the package to render
 * the scaled content + viewport overlay into. Kept separate from {@link
 * minimapExtension} so the compartment can be reconfigured without recreating
 * the host element shape.
 */
function createMinimapHost(view: EditorView): { dom: HTMLElement } {
  const dom = document.createElement("div");
  dom.className = "cm-minimap-host";
  dom.setAttribute("aria-hidden", "true");
  // Avoid focus stealing / interactive cursor on the scaled overview; the
  // overlay plugin handles drag-to-scroll on its own container.
  dom.style.pointerEvents = "none";
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
  return showMinimap.compute(["doc"], () => (enabled ? MINIMAP_CONFIG : null));
}
