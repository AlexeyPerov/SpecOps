import { describe, expect, it } from "vitest";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  BASE_KEYMAP_PRECEDENCE,
  buildNamedExtensionGroups,
  createEditorExtensionCompartments,
  flattenExtensionGroups,
} from "./editorExtensions";
import { createSearchHighlightExtension } from "./searchHighlight";

describe("editorExtensions", () => {
  it("documents base keymap precedence", () => {
    expect(BASE_KEYMAP_PRECEDENCE).toEqual([
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
        createSearchHighlightExtension("x", false),
      ),
    });
    expect(compartments.language.get(view.state)).toBe(beforeLanguage);
    expect(compartments.searchHighlight.get(view.state)).not.toEqual([]);

    view.destroy();
    parent.remove();
  });
});
