/**
 * CodeMirror folding extensions: gutter, keymap, and placeholder theming.
 * Fold state lives in EditorState (session-cache ephemeral) and is never
 * written to app session storage.
 */
import type { Extension } from "@codemirror/state";
import {
  codeFolding,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
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
 * Folding extension group for the reserved `fold` compartment.
 *
 * The fold gutter materially adds width (~14px), so visibility is a global
 * setting (`showFoldGutter`, default on). Fold keymap and folding plumbing
 * stay active even when the gutter is hidden so commands still work.
 */
export function foldExtension(options: { showGutter: boolean }): Extension {
  const { showGutter } = options;
  return [
    codeFolding({
      placeholderText: "…",
    }),
    keymap.of(foldKeymap),
    foldTheme(),
    ...(showGutter
      ? [
          foldGutter({
            markerDOM: createFoldMarker,
          }),
        ]
      : []),
  ];
}
