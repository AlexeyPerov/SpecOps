import { afterEach, describe, expect, it } from "vitest";
import { createEditorDocumentSessionCache } from "./editorDocumentSessionCache";
import { createSearchHighlightExtension } from "./searchHighlight";
import {
  createEditorViewController,
  type EditorViewController,
} from "./editorViewController";
import { createEditorWorkbenchRuntime } from "./editorWorkbenchRuntime";

describe("editor composition — per-pane search compartments", () => {
  let controllers: EditorViewController[] = [];
  let parents: HTMLDivElement[] = [];

  afterEach(() => {
    for (const c of controllers) {
      c.destroy();
    }
    controllers = [];
    for (const p of parents) {
      p.remove();
    }
    parents = [];
  });

  it("keeps independent search highlight compartments across panes", () => {
    const workbench = createEditorWorkbenchRuntime({
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-a",
    });
    const sessionCache = createEditorDocumentSessionCache();

    function mount(paneId: string, documentId: string) {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      parents.push(parent);
      const controller = createEditorViewController({
        workbench,
        sessionCache,
        onStatusMessage: () => {},
        onDocumentDirty: () => {},
        onScrollTopChange: () => {},
      });
      controller.update({
        content: "alpha beta alpha",
        documentId,
        paneId,
        scrollTop: 0,
        wrapLines: false,
        zoomPercent: 100,
        language: "plaintext",
        decoratePlaintextSymbols: false,
        showMinimap: false,
        showFoldGutter: true,
        autoClosePairs: true,
        autoSuggest: false,
        enabledSnippets: [],
      });
      controller.mount(parent);
      controllers.push(controller);
      return controller;
    }

    const a = mount("pane-a", "doc-a");
    const b = mount("pane-b", "doc-b");

    expect(a.getCompartments().searchHighlight).not.toBe(
      b.getCompartments().searchHighlight,
    );

    const viewA = a.getView()!;
    const viewB = b.getView()!;
    const beforeB = b.getCompartments().searchHighlight.get(viewB.state);

    viewA.dispatch({
      effects: a
        .getCompartments()
        .searchHighlight.reconfigure(createSearchHighlightExtension("alpha", false)),
    });

    // Pane B's search compartment content is unchanged.
    expect(b.getCompartments().searchHighlight.get(viewB.state)).toBe(beforeB);
    expect(a.getCompartments().searchHighlight.get(viewA.state)).not.toEqual([]);
  });
});
