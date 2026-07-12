import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import {
  createCodeMirrorFixture,
  dispatchUserEdit,
  type CodeMirrorFixture,
} from "./codeMirrorFixture";
import { createEditorDocumentSessionCache } from "./editorDocumentSessionCache";
import { createEditorViewController } from "./editorViewController";
import { createEditorWorkbenchRuntime } from "./editorWorkbenchRuntime";

/**
 * M0.1 characterization of CodeMirror integration and document-switch behavior.
 *
 * M0.3 invariant: editor session state (selection, undo history, and future
 * fold/completion/bookmark fields) is document-scoped via the view controller
 * + session cache. The fixture's `replaceContent` path remains the legacy
 * pane-scoped baseline.
 */
describe("CodeMirror fixture characterization", () => {
  let fixture: CodeMirrorFixture | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    expect(document.body.querySelector(".cm-editor")).toBeNull();
  });

  it("reports user document edits exactly once", () => {
    const dirty = vi.fn();
    fixture = createCodeMirrorFixture({ doc: "alpha", onDocumentDirty: dirty });

    dispatchUserEdit(fixture.view, {
      changes: { from: 5, to: 5, insert: "!" },
    });

    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty).toHaveBeenCalledWith("alpha!");
    expect(fixture.view.state.doc.toString()).toBe("alpha!");
  });

  it("reports non-empty selection changes", () => {
    const selections: Array<{ from: number; to: number; empty: boolean }> = [];
    fixture = createCodeMirrorFixture({
      doc: "hello world",
      onSelectionChange: (sel) => selections.push(sel),
    });

    fixture.setSelection(0, 5);

    expect(selections.at(-1)).toEqual({
      from: 0,
      to: 5,
      head: 5,
      empty: false,
    });
    expect(fixture.view.state.selection.main.from).toBe(0);
    expect(fixture.view.state.selection.main.to).toBe(5);
  });

  it("does not report a dirty edit for programmatic content replacement", () => {
    const dirty = vi.fn();
    fixture = createCodeMirrorFixture({ doc: "doc-a", onDocumentDirty: dirty });

    fixture.replaceContent("doc-b");

    expect(dirty).not.toHaveBeenCalled();
    expect(fixture.view.state.doc.toString()).toBe("doc-b");
  });

  it("applies wrap and zoom reconfiguration without dirtying the document", () => {
    const dirty = vi.fn();
    fixture = createCodeMirrorFixture({ doc: "wrap me", onDocumentDirty: dirty });

    fixture.setWrap(true);
    fixture.setZoom(150);

    expect(dirty).not.toHaveBeenCalled();
    expect(fixture.view.state.doc.toString()).toBe("wrap me");
  });

  it("installs search highlight decorations for a query", () => {
    fixture = createCodeMirrorFixture({ doc: "alpha beta alpha" });
    fixture.setSearchHighlight("alpha", false);

    const marks = fixture.view.dom.querySelectorAll(".cm-search-match");
    expect(marks.length).toBeGreaterThanOrEqual(1);
  });

  it("destroys the view and removes editor DOM", () => {
    fixture = createCodeMirrorFixture({ doc: "cleanup" });
    expect(document.body.contains(fixture.parent)).toBe(true);
    expect(fixture.parent.querySelector(".cm-editor")).not.toBeNull();

    fixture.destroy();
    fixture = undefined;

    expect(document.body.querySelector(".cm-editor")).toBeNull();
  });

  it("restores document-scoped A→B→A history/selection via session cache", () => {
    // M0.3 target: selection and undo history belong to the document, not the pane.
    const sessionCache = createEditorDocumentSessionCache();
    const workbench = createEditorWorkbenchRuntime({
      getActivePaneId: () => "pane-1",
      getActiveDocumentId: () => "doc-a",
    });
    const controller = createEditorViewController({
      workbench,
      sessionCache,
      onStatusMessage: () => {},
      onDocumentDirty: () => {},
      onScrollTopChange: () => {},
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    controller.update({
      content: "document-a",
      documentId: "doc-a",
      paneId: "pane-1",
      scrollTop: 0,
      wrapLines: false,
      zoomPercent: 100,
      language: "plaintext",
      decoratePlaintextSymbols: true,
      showMinimap: false,
      showFoldGutter: true,
      autoClosePairs: true,
      autoSuggest: false,
    });
    controller.mount(parent);
    const view = controller.getView()!;

    view.dispatch({ selection: EditorSelection.range(2, 8) });
    dispatchUserEdit(view, {
      changes: { from: 10, to: 10, insert: "-edited" },
    });
    const selectionAfterAEdit = {
      from: view.state.selection.main.from,
      to: view.state.selection.main.to,
    };

    controller.update({
      content: "document-b",
      documentId: "doc-b",
      paneId: "pane-1",
      scrollTop: 0,
      wrapLines: false,
      zoomPercent: 100,
      language: "plaintext",
      decoratePlaintextSymbols: true,
      showMinimap: false,
      showFoldGutter: true,
      autoClosePairs: true,
      autoSuggest: false,
    });
    view.dispatch({ selection: EditorSelection.cursor(9) });
    dispatchUserEdit(view, {
      changes: { from: 0, to: 0, insert: "x" },
    });

    controller.update({
      content: "document-a-edited",
      documentId: "doc-a",
      paneId: "pane-1",
      scrollTop: 0,
      wrapLines: false,
      zoomPercent: 100,
      language: "plaintext",
      decoratePlaintextSymbols: true,
      showMinimap: false,
      showFoldGutter: true,
      autoClosePairs: true,
      autoSuggest: false,
    });

    expect(view.state.selection.main.from).toBe(selectionAfterAEdit.from);
    expect(view.state.selection.main.to).toBe(selectionAfterAEdit.to);
    undo(view);
    expect(view.state.doc.toString()).toBe("document-a");

    controller.destroy();
    parent.remove();
    workbench.dispose();
    sessionCache.clear();
  });

  it("characterizes fixture replaceContent as pane-scoped (legacy path)", () => {
    fixture = createCodeMirrorFixture({ doc: "document-a" });
    fixture.setSelection(2, 8);
    dispatchUserEdit(fixture.view, {
      changes: { from: 10, to: 10, insert: "-edited" },
    });
    const selectionAfterAEdit = {
      from: fixture.view.state.selection.main.from,
      to: fixture.view.state.selection.main.to,
    };

    fixture.replaceContent("document-b");
    fixture.setSelection(9, 9);
    dispatchUserEdit(fixture.view, {
      changes: { from: 0, to: 0, insert: "x" },
    });

    fixture.replaceContent("document-a-edited");

    // Legacy muted replace keeps pane-scoped selection/history.
    expect(fixture.view.state.selection.main.from).not.toBe(selectionAfterAEdit.from);
    const beforeUndo = fixture.view.state.doc.toString();
    undo(fixture.view);
    expect(fixture.view.state.doc.toString()).not.toBe(beforeUndo);
  });

  it("routes commands to the view registered as the active pane", () => {
    const first = createCodeMirrorFixture({ doc: "pane-one" });
    const second = createCodeMirrorFixture({ doc: "pane-two" });

    let activeView: ReturnType<typeof createCodeMirrorFixture>["view"] | undefined =
      first.view;
    const runner = first.createCommandRunner(() => activeView);

    first.setSelection(0, 4);
    second.setSelection(0, 4);

    activeView = second.view;
    const moved = runner.findNext("two", false);
    expect(moved).toBe(true);
    expect(second.view.state.selection.main.from).toBe(5);
    expect(first.view.state.selection.main.from).toBe(0);

    // Unregister / teardown: getView returns undefined → commands must not target a stale editor.
    activeView = undefined;
    expect(runner.findNext("one", false)).toBe(false);
    expect(first.view.state.doc.toString()).toBe("pane-one");

    first.destroy();
    second.destroy();
  });

  it("does not double-report dirty when an edit is dispatched once", () => {
    const dirty = vi.fn();
    fixture = createCodeMirrorFixture({ doc: "once", onDocumentDirty: dirty });

    fixture.view.dispatch({
      changes: { from: 4, to: 4, insert: "!" },
      selection: EditorSelection.cursor(5),
      userEvent: "input",
    });

    expect(dirty).toHaveBeenCalledTimes(1);
  });
});
