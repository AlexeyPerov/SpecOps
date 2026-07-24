/**
 * CodeMirror folding extensions: gutter, keymap, and placeholder theming.
 * Fold state lives in EditorState (session-cache ephemeral) and is never
 * written to app session storage.
 *
 * IMPORTANT: `@codemirror/language`'s `foldGutter()` appends `codeFolding()`
 * (the fold `StateField`). That field must never live in a reconfigurable
 * `Compartment` — replacing it after mount deadlocks CodeMirror's facet
 * resolver (infinite `flatten`/`inner` recursion) and freezes the UI.
 */
import type { Extension } from "@codemirror/state";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("button");
  marker.type = "button";
  marker.className = open ? "cm-foldMarker cm-foldMarker-open" : "cm-foldMarker cm-foldMarker-closed";
  marker.setAttribute("aria-label", open ? "Fold code" : "Unfold code");
  marker.title = open ? "Fold" : "Unfold";
  marker.tabIndex = -1;
  marker.textContent = open ? "⌄" : "›";
  return marker;
}

/** Theme rules for fold gutter markers and placeholders. */
export function foldTheme(): Extension {
  return EditorView.theme({
    ".cm-foldGutter": {
      width: "14px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0",
    },
    ".cm-foldMarker": {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "12px",
      height: "12px",
      margin: "0",
      padding: "0",
      border: "none",
      background: "transparent",
      color: "var(--color-text-secondary)",
      fontSize: "11px",
      lineHeight: "1",
      cursor: "pointer",
    },
    ".cm-foldMarker:hover": {
      color: "var(--color-text-primary)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--color-hover)",
      border: "1px solid var(--color-border-subtle)",
      borderRadius: "2px",
      color: "var(--color-text-secondary)",
      margin: "0 2px",
      padding: "0 4px",
      cursor: "pointer",
    },
  });
}

/**
 * Stable folding plumbing — must NOT live in a reconfigurable compartment.
 *
 * Uses `foldGutter()` once (it already includes `codeFolding()`'s StateField).
 * Gutter visibility is toggled separately via {@link foldGutterExtension}
 * (CSS only) so the StateField is never added/removed after mount.
 */
export function foldBaseExtension(): Extension {
  return [
    foldGutter({
      markerDOM: createFoldMarker,
    }),
    keymap.of(foldKeymap),
    foldTheme(),
  ];
}

/**
 * Fold gutter visibility only — safe to put in a compartment and reconfigure.
 *
 * Never calls `foldGutter()` / `codeFolding()` here. Hiding is CSS-only so the
 * fold StateField installed by {@link foldBaseExtension} stays fixed.
 */
export function foldGutterExtension(showGutter: boolean): Extension {
  if (showGutter) {
    return [];
  }
  return EditorView.theme({
    ".cm-foldGutter": {
      display: "none",
      width: "0",
    },
  });
}

/**
 * Full folding bundle (base + optional hide). Prefer `foldBaseExtension` +
 * `foldGutterExtension` when wiring compartments so the StateField stays fixed.
 */
export function foldExtension(options: { showGutter: boolean }): Extension {
  return [foldBaseExtension(), foldGutterExtension(options.showGutter)];
}
