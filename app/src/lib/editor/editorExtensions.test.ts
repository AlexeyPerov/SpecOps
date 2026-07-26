import { describe, expect, it } from "vitest";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  BASE_KEYMAP_PRECEDENCE,
  applyWrap,
  applyZoom,
  buildNamedExtensionGroups,
  createEditorExtensionCompartments,
  flattenExtensionGroups,
} from "./editorExtensions";
import { createSearchHighlightExtension } from "./searchHighlight";

/** Total CSS rules injected into the document by every mounted StyleModule. */
function countInjectedStyleRules(): number {
  let total = 0;
  for (const style of Array.from(document.querySelectorAll("style"))) {
    try {
      total += style.sheet?.cssRules.length ?? 0;
    } catch {
      // Unreadable sheet — ignore.
    }
  }
  return total;
}

describe("editorExtensions", () => {
  it("documents base keymap precedence", () => {
    expect(BASE_KEYMAP_PRECEDENCE).toEqual([
      "searchKeymap",
      "indentWithTab",
      "defaultKeymap",
      "historyKeymap",
    ]);
  });

  it("assembles named groups in a stable order with reserved seams", () => {
    const compartments = createEditorExtensionCompartments();
    const groups = buildNamedExtensionGroups({
      compartments,
      language: "plaintext",
      showMinimap: true,
    });

    expect(groups.map((g) => g.name)).toEqual([
      "base",
      "language",
      "highlight",
      "decorations",
      "search",
      "minimap",
      "fold",
      "completion",
      "snippets",
      "landmarks",
      "theme",
      "updateListener",
    ]);

    const flat = flattenExtensionGroups(groups);
    expect(flat.length).toBeGreaterThan(0);
  });

  it("creates independent compartment instances per assembly", () => {
    const a = createEditorExtensionCompartments();
    const b = createEditorExtensionCompartments();
    expect(a.searchHighlight).not.toBe(b.searchHighlight);
    expect(a.language).not.toBe(b.language);
    expect(a.fold).toBeInstanceOf(Compartment);
    expect(a.completion).toBeInstanceOf(Compartment);
  });

  it("does not grow the CSSOM per editor state or repeated zoom/wrap toggle", () => {
    // Themes are StyleModules and style-mod only ever inserts rules — nothing
    // unmounts them. Rebuilding a theme per EditorState (one per document open)
    // or per toggle grew the stylesheet for the whole session.
    const mounted: Array<{ view: EditorView; parent: HTMLElement }> = [];
    const mount = () => {
      const compartments = createEditorExtensionCompartments();
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        extensions: flattenExtensionGroups(
          buildNamedExtensionGroups({
            compartments,
            language: "markdown",
            showMinimap: true,
            wrapLines: true,
          }),
        ),
      });
      mounted.push({ view, parent });
      return { view, compartments };
    };

    try {
      const first = mount();
      const afterFirstMount = countInjectedStyleRules();
      expect(afterFirstMount).toBeGreaterThan(0);

      mount();
      mount();
      expect(countInjectedStyleRules()).toBe(afterFirstMount);

      // A genuinely new font size inserts one rule set; repeating known sizes
      // must reuse it.
      applyZoom(first.view, first.compartments.fontSize, 150);
      const afterNewZoom = countInjectedStyleRules();
      for (let i = 0; i < 5; i += 1) {
        applyZoom(first.view, first.compartments.fontSize, 100);
        applyZoom(first.view, first.compartments.fontSize, 150);
        applyWrap(first.view, first.compartments.lineWrap, false);
        applyWrap(first.view, first.compartments.lineWrap, true);
      }
      expect(countInjectedStyleRules()).toBe(afterNewZoom);
    } finally {
      for (const { view, parent } of mounted) {
        view.destroy();
        parent.remove();
      }
    }
  });

  it("reconfigures search without touching unrelated compartments", () => {
    const compartments = createEditorExtensionCompartments();
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const view = new EditorView({
      parent,
      extensions: flattenExtensionGroups(
        buildNamedExtensionGroups({
          compartments,
          language: "plaintext",
          showMinimap: false,
        }),
      ),
    });

    const beforeLanguage = compartments.language.get(view.state);
    view.dispatch({
      effects: compartments.searchHighlight.reconfigure(
        createSearchHighlightExtension({
          text: "x",
          replacement: "",
          caseSensitive: false,
          wholeWord: false,
          regexp: false,
        }),
      ),
    });
    expect(compartments.language.get(view.state)).toBe(beforeLanguage);
    expect(compartments.searchHighlight.get(view.state)).not.toEqual([]);

    view.destroy();
    parent.remove();
  });

  it("enables allowMultipleSelections in the base group", () => {
    const compartments = createEditorExtensionCompartments();
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const view = new EditorView({
      parent,
      extensions: flattenExtensionGroups(
        buildNamedExtensionGroups({
          compartments,
          language: "plaintext",
          showMinimap: false,
        }),
      ),
    });

    // allowMultipleSelections facet should permit multiple ranges.
    expect(view.state.facet(EditorState.allowMultipleSelections)).toBe(true);

    view.destroy();
    parent.remove();
  });

  it("supports adding multiple cursors via transaction", () => {
    const compartments = createEditorExtensionCompartments();
    const parent = document.createElement("div");
    document.body.appendChild(parent);

    const view = new EditorView({
      parent,
      extensions: flattenExtensionGroups(
        buildNamedExtensionGroups({
          compartments,
          language: "plaintext",
          showMinimap: false,
        }),
      ),
    });

    // Seed some content so positions 0 and 1 are valid.
    view.dispatch({ changes: { from: 0, insert: "hi" } });

    // Two cursors — only possible when allowMultipleSelections is enabled.
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(1),
      ]),
    });
    expect(view.state.selection.ranges).toHaveLength(2);

    view.destroy();
    parent.remove();
  });
});
