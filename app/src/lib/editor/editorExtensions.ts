/**
 * Instance-owned CodeMirror extension assembly.
 *
 * Extension groups are reconfigured independently via compartments. Each
 * editor controller owns its own compartment instances so simultaneous panes
 * never share mutable configuration slots (especially search highlight).
 *
 * Keymap precedence (first match wins inside `keymap.of`):
 * 1. `indentWithTab` — Tab / Shift-Tab indent
 * 2. `defaultKeymap` — movement, delete, select-all, etc.
 * 3. `historyKeymap` — Mod-z / Mod-y (and platform variants)
 *
 * Reserved empty compartments (`fold`, `completion`, `snippets`, `landmarks`)
 * are seams for M4–M7; reconfigure them later without rebuilding base/theme.
 */
import { Compartment, type Extension } from "@codemirror/state";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { createSyntaxHighlightExtension } from "./editorHighlight";
import {
  getLanguageSupport,
  type EditorLanguageId,
} from "./editorLanguage";
import { minimapExtension } from "./editorMinimap";

/** Named groups assembled into the editor state. */
export type EditorExtensionGroupName =
  | "base"
  | "theme"
  | "language"
  | "highlight"
  | "decorations"
  | "search"
  | "minimap"
  | "fold"
  | "completion"
  | "snippets"
  | "landmarks"
  | "updateListener";

/**
 * Documented base keymap order. Tests assert this sequence so future
 * feature keymaps can be inserted intentionally rather than by accident.
 */
export const BASE_KEYMAP_PRECEDENCE = [
  "indentWithTab",
  "defaultKeymap",
  "historyKeymap",
] as const;

export type EditorExtensionCompartments = {
  lineWrap: Compartment;
  fontSize: Compartment;
  language: Compartment;
  highlight: Compartment;
  decoration: Compartment;
  searchHighlight: Compartment;
  minimap: Compartment;
  /** M4 seam — folding. */
  fold: Compartment;
  /** M5 seam — autocomplete. */
  completion: Compartment;
  /** M6 seam — snippet expansion. */
  snippets: Compartment;
  /** M7 seam — bookmarks / landmarks. */
  landmarks: Compartment;
};

export type BuildEditorExtensionsOptions = {
  compartments: EditorExtensionCompartments;
  language: EditorLanguageId;
  showMinimap: boolean;
  /** Optional update listener (dirty reporting, cursor). */
  updateListener?: Extension;
};

export function createEditorExtensionCompartments(): EditorExtensionCompartments {
  return {
    lineWrap: new Compartment(),
    fontSize: new Compartment(),
    language: new Compartment(),
    highlight: new Compartment(),
    decoration: new Compartment(),
    searchHighlight: new Compartment(),
    minimap: new Compartment(),
    fold: new Compartment(),
    completion: new Compartment(),
    snippets: new Compartment(),
    landmarks: new Compartment(),
  };
}

function baseFontSizeExtension(): Extension {
  return EditorView.theme({
    "&": {
      fontSize: "var(--font-size-editor, 13px)",
    },
  });
}

function editorSurfaceTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      width: "100%",
      maxWidth: "100%",
      fontFamily: "var(--font-family-ui)",
      color: "var(--color-text-primary)",
      backgroundColor: "var(--color-surface-1)",
    },
    ".cm-content, .cm-gutter": {
      minHeight: "100%",
    },
    ".cm-content": {
      caretColor: "var(--color-text-primary)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--color-surface-1)",
      color: "var(--color-text-secondary)",
      borderRight: "1px solid var(--color-border-subtle)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "var(--color-hover)",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-text-primary)",
    },
    ".cm-minimap-gutter": {
      borderLeft: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-surface-1)",
    },
    ".cm-minimap-overlay-container .cm-minimap-overlay": {
      background: "var(--color-hover)",
    },
  });
}

/** Ordered extension list with named group markers for tests. */
export type NamedExtensionGroup = {
  name: EditorExtensionGroupName;
  extensions: Extension[];
};

export function buildNamedExtensionGroups(
  options: BuildEditorExtensionsOptions,
): NamedExtensionGroup[] {
  const { compartments, language, showMinimap, updateListener } = options;

  return [
    {
      name: "base",
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        compartments.lineWrap.of([]),
        compartments.fontSize.of(baseFontSizeExtension()),
      ],
    },
    {
      name: "language",
      extensions: [compartments.language.of(getLanguageSupport(language) ?? [])],
    },
    {
      name: "highlight",
      extensions: [compartments.highlight.of(createSyntaxHighlightExtension())],
    },
    {
      name: "decorations",
      extensions: [compartments.decoration.of([])],
    },
    {
      name: "search",
      extensions: [compartments.searchHighlight.of([])],
    },
    {
      name: "minimap",
      extensions: [compartments.minimap.of(minimapExtension(showMinimap))],
    },
    {
      name: "fold",
      extensions: [compartments.fold.of([])],
    },
    {
      name: "completion",
      extensions: [compartments.completion.of([])],
    },
    {
      name: "snippets",
      extensions: [compartments.snippets.of([])],
    },
    {
      name: "landmarks",
      extensions: [compartments.landmarks.of([])],
    },
    {
      name: "theme",
      extensions: [editorSurfaceTheme()],
    },
    {
      name: "updateListener",
      extensions: updateListener ? [updateListener] : [],
    },
  ];
}

export function flattenExtensionGroups(groups: NamedExtensionGroup[]): Extension[] {
  return groups.flatMap((group) => group.extensions);
}

export function buildEditorExtensions(options: BuildEditorExtensionsOptions): Extension[] {
  return flattenExtensionGroups(buildNamedExtensionGroups(options));
}

export function applyWrap(
  view: EditorView,
  lineWrapCompartment: Compartment,
  nextWrap: boolean,
): void {
  view.dispatch({
    effects: lineWrapCompartment.reconfigure(
      nextWrap
        ? [
            EditorView.lineWrapping,
            EditorView.theme({
              ".cm-scroller": {
                overflowX: "hidden",
              },
            }),
          ]
        : [],
    ),
  });
}

function resolveEditorBaseFontSizePx(): number {
  if (typeof document !== "undefined") {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--font-size-editor")
      .trim();
    if (raw.length > 0) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 13;
}

export function applyZoom(
  view: EditorView,
  fontSizeCompartment: Compartment,
  nextZoom: number,
): void {
  const base = resolveEditorBaseFontSizePx();
  const px = Math.round((base * nextZoom) / 100);
  view.dispatch({
    effects: fontSizeCompartment.reconfigure(
      EditorView.theme({
        "&": {
          fontSize: `${px}px`,
        },
      }),
    ),
  });
}
