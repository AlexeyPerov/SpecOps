import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { createEditorDocumentSessionCache } from "./editorDocumentSessionCache";
import {
  createEditorViewController,
  type EditorViewController,
} from "./editorViewController";
import { createEditorWorkbenchRuntime } from "./editorWorkbenchRuntime";
import { getLanguageSupport } from "./editorLanguage";

describe("editor mount regressions", () => {
  let controller: EditorViewController | undefined;
  let parent: HTMLDivElement | undefined;

  afterEach(() => {
    controller?.destroy();
    controller = undefined;
    parent?.remove();
    parent = undefined;
  });

  function mount(language: string, content = "hello") {
    parent = document.createElement("div");
    document.body.appendChild(parent);
    const workbench = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-1",
      getActiveDocumentId: () => "doc-1",
    });
    controller = createEditorViewController({
      workbench,
      sessionCache: createEditorDocumentSessionCache(),
      onStatusMessage: () => {},
      onDocumentDirty: () => {},
      onScrollTopChange: () => {},
    });
    controller.update({
      content,
      documentId: "doc-1",
      contextId: "notepad",
      paneId: "pane-1",
      scrollTop: 0,
      wrapLines: false,
      zoomPercent: 100,
      language,
      decoratePlaintextSymbols: false,
      showMinimap: false,
      showFoldGutter: true,
      autoClosePairs: true,
      autoSuggest: false,
      enabledSnippets: [],
    });
    controller.mount(parent);
    return controller;
  }

  it("accepts typed input after mount", () => {
    const c = mount("plaintext");
    const view = c.getView()!;
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "!" },
      selection: EditorSelection.cursor(view.state.doc.length + 1),
    });
    expect(view.state.doc.toString()).toBe("hello!");
    view.focus();
    expect(view.hasFocus).toBe(true);
  });

  it("loads language support after mount even when language id is seeded", async () => {
    // Use a language that is unlikely to already be cached from other tests.
    const language = "python";
    expect(getLanguageSupport(language)).toBeNull();
    const c = mount(language, "x = 1\n");
    // Simulate the EditorSurface $effect that runs after mount with same props.
    c.update({
      content: "x = 1\n",
      documentId: "doc-1",
      contextId: "notepad",
      paneId: "pane-1",
      scrollTop: 0,
      wrapLines: false,
      zoomPercent: 100,
      language,
      decoratePlaintextSymbols: false,
      showMinimap: false,
      showFoldGutter: true,
      autoClosePairs: true,
      autoSuggest: false,
      enabledSnippets: [],
    });
    await vi.waitFor(() => {
      expect(getLanguageSupport(language)).not.toBeNull();
    });
  });
});
