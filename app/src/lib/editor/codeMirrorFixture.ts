/**
 * Reusable jsdom CodeMirror fixture for characterization tests.
 * Mirrors the EditorSurface mount path without a Svelte harness.
 */
import {
  Compartment,
  EditorSelection,
  EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { createEditorCommandRunner } from "./editorCommandRunner";
import { createSearchHighlightExtension } from "./searchHighlight";
import type { EditorCommandRunner } from "../types/editor";

export type CodeMirrorFixtureOptions = {
  doc?: string;
  extensions?: Extension[];
  onDocumentDirty?: (nextContent: string) => void;
  onSelectionChange?: (selection: {
    from: number;
    to: number;
    head: number;
    empty: boolean;
  }) => void;
  onStatusMessage?: (message: string) => void;
};

export type CodeMirrorFixture = {
  parent: HTMLDivElement;
  view: EditorView;
  lineWrapCompartment: Compartment;
  fontSizeCompartment: Compartment;
  searchHighlightCompartment: Compartment;
  /** Replace document content without reporting a user dirty edit (EditorSurface mute path). */
  replaceContent: (next: string) => void;
  setSelection: (from: number, to?: number) => void;
  setWrap: (wrap: boolean) => void;
  setZoom: (zoomPercent: number) => void;
  setSearchHighlight: (query: string, caseSensitive: boolean) => void;
  createCommandRunner: (getView?: () => EditorView | undefined) => EditorCommandRunner;
  destroy: () => void;
};

/**
 * Mount an EditorView under `document.body`. Call `destroy()` in afterEach.
 */
export function createCodeMirrorFixture(
  options: CodeMirrorFixtureOptions = {},
): CodeMirrorFixture {
  const {
    doc = "",
    extensions = [],
    onDocumentDirty = () => {},
    onSelectionChange = () => {},
    onStatusMessage = () => {},
  } = options;

  const parent = document.createElement("div");
  document.body.appendChild(parent);

  const lineWrapCompartment = new Compartment();
  const fontSizeCompartment = new Compartment();
  const searchHighlightCompartment = new Compartment();
  let muted = false;

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      history(),
      keymap.of(historyKeymap),
      lineWrapCompartment.of([]),
      fontSizeCompartment.of(
        EditorView.theme({
          "&": { fontSize: "13px" },
        }),
      ),
      searchHighlightCompartment.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !muted) {
          onDocumentDirty(update.state.doc.toString());
        }
        if (update.selectionSet) {
          const range = update.state.selection.main;
          onSelectionChange({
            from: range.from,
            to: range.to,
            head: range.head,
            empty: range.empty,
          });
        }
      }),
      ...extensions,
    ],
  });

  const view = new EditorView({ state, parent });

  function replaceContent(next: string): void {
    if (next === view.state.doc.toString()) {
      return;
    }
    muted = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
    muted = false;
  }

  function setSelection(from: number, to: number = from): void {
    view.dispatch({
      selection: EditorSelection.range(from, to),
    });
  }

  function setWrap(wrap: boolean): void {
    view.dispatch({
      effects: lineWrapCompartment.reconfigure(
        wrap
          ? [
              EditorView.lineWrapping,
              EditorView.theme({
                ".cm-scroller": { overflowX: "hidden" },
              }),
            ]
          : [],
      ),
    });
  }

  function setZoom(zoomPercent: number): void {
    const px = Math.round((13 * zoomPercent) / 100);
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(
        EditorView.theme({
          "&": { fontSize: `${px}px` },
        }),
      ),
    });
  }

  function setSearchHighlight(query: string, caseSensitive: boolean): void {
    const next: Extension = query
      ? createSearchHighlightExtension({
          text: query,
          replacement: "",
          caseSensitive,
          wholeWord: false,
          regexp: false,
        })
      : [];
    view.dispatch({
      effects: searchHighlightCompartment.reconfigure(next),
    });
  }

  function createCommandRunner(
    getView: () => EditorView | undefined = () => view,
  ): EditorCommandRunner {
    return createEditorCommandRunner({
      getView,
      lineWrapCompartment,
      fontSizeCompartment,
      searchHighlightCompartment,
      onStatusMessage,
      updateCursor: () => {
        const range = (getView() ?? view).state.selection.main;
        onSelectionChange({
          from: range.from,
          to: range.to,
          head: range.head,
          empty: range.empty,
        });
      },
    });
  }

  function destroy(): void {
    view.destroy();
    parent.remove();
  }

  return {
    parent,
    view,
    lineWrapCompartment,
    fontSizeCompartment,
    searchHighlightCompartment,
    replaceContent,
    setSelection,
    setWrap,
    setZoom,
    setSearchHighlight,
    createCommandRunner,
    destroy,
  };
}

/** Dispatch a user-origin edit (counts as dirty). */
export function dispatchUserEdit(view: EditorView, spec: TransactionSpec): void {
  view.dispatch({
    ...spec,
    userEvent: spec.userEvent ?? "input",
  });
}
