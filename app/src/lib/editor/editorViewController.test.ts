import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, Transaction } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { createEditorDocumentSessionCache } from "./editorDocumentSessionCache";
import { createEditorWorkbenchRuntime } from "./editorWorkbenchRuntime";
import {
  createEditorViewController,
  type EditorViewController,
  type EditorViewControllerProps,
} from "./editorViewController";
import { dispatchUserEdit } from "./codeMirrorFixture";
import {
  storeOriginAnnotation,
  transactionHasStoreOrigin,
} from "./editorTransactions";

function baseProps(
  overrides: Partial<EditorViewControllerProps> = {},
): EditorViewControllerProps {
  return {
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
    ...overrides,
  };
}

describe("createEditorViewController", () => {
  let controller: EditorViewController | undefined;
  let parent: HTMLDivElement | undefined;

  afterEach(() => {
    controller?.destroy();
    controller = undefined;
    parent?.remove();
    parent = undefined;
    expect(document.body.querySelector(".cm-editor")).toBeNull();
  });

  function mountController(
    props: EditorViewControllerProps = baseProps(),
    options: {
      onDocumentDirty?: (content: string) => void;
      onScrollTopChange?: (documentId: string, scrollTop: number) => void;
      maxEntries?: number;
    } = {},
  ) {
    const sessionCache = createEditorDocumentSessionCache({
      maxEntries: options.maxEntries,
    });
    const workbench = createEditorWorkbenchRuntime({
      getActivePaneId: () => props.paneId,
      getActiveDocumentId: () => props.documentId,
    });
    const dirty = options.onDocumentDirty ?? vi.fn();
    const scroll = options.onScrollTopChange ?? vi.fn();
    controller = createEditorViewController({
      workbench,
      sessionCache,
      onStatusMessage: () => {},
      onDocumentDirty: dirty,
      onScrollTopChange: scroll,
    });
    parent = document.createElement("div");
    document.body.appendChild(parent);
    controller.update(props);
    controller.mount(parent);
    return { controller, sessionCache, workbench, dirty, scroll };
  }

  it("reports user edits and ignores store-origin replacements", () => {
    const dirty = vi.fn();
    mountController(baseProps(), { onDocumentDirty: dirty });
    const view = controller!.getView()!;

    dispatchUserEdit(view, {
      changes: { from: 10, to: 10, insert: "-edited" },
    });
    expect(dirty).toHaveBeenCalledTimes(1);
    expect(dirty).toHaveBeenCalledWith("document-a-edited");

    dirty.mockClear();
    controller!.update(
      baseProps({ content: "external-reload" }),
    );
    expect(dirty).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("external-reload");
  });

  it("restores selection and undo history across A → B → A", () => {
    mountController();
    const view = controller!.getView()!;

    view.dispatch({
      selection: EditorSelection.range(2, 8),
    });
    dispatchUserEdit(view, {
      changes: { from: 10, to: 10, insert: "-edited" },
    });
    const selectionAfterA = {
      from: view.state.selection.main.from,
      to: view.state.selection.main.to,
    };
    expect(view.state.doc.toString()).toBe("document-a-edited");

    controller!.update(
      baseProps({
        content: "document-b",
        documentId: "doc-b",
      }),
    );
    expect(view.state.doc.toString()).toBe("document-b");
    view.dispatch({ selection: EditorSelection.cursor(9) });
    dispatchUserEdit(view, {
      changes: { from: 0, to: 0, insert: "x" },
    });
    expect(view.state.doc.toString()).toBe("xdocument-b");

    controller!.update(
      baseProps({
        content: "document-a-edited",
        documentId: "doc-a",
      }),
    );

    expect(view.state.doc.toString()).toBe("document-a-edited");
    expect(view.state.selection.main.from).toBe(selectionAfterA.from);
    expect(view.state.selection.main.to).toBe(selectionAfterA.to);

    undo(view);
    expect(view.state.doc.toString()).toBe("document-a");
  });

  it("does not resurrect stale cached content after external reload of inactive doc", () => {
    const { sessionCache } = mountController();
    const view = controller!.getView()!;

    dispatchUserEdit(view, {
      changes: { from: 10, to: 10, insert: "-old" },
    });
    expect(view.state.doc.toString()).toBe("document-a-old");

    controller!.update(
      baseProps({ content: "document-b", documentId: "doc-b" }),
    );
    expect(sessionCache.has({ paneId: "pane-1", documentId: "doc-a" })).toBe(true);

    // Simulate disk reload invalidation for inactive A.
    sessionCache.invalidateDocument("doc-a");
    controller!.update(
      baseProps({
        content: "document-a-reloaded",
        documentId: "doc-a",
      }),
    );

    expect(view.state.doc.toString()).toBe("document-a-reloaded");
    undo(view);
    // Fresh session after invalidation — undo must not revive pre-reload content.
    expect(view.state.doc.toString()).toBe("document-a-reloaded");
  });

  it("flushes scroll once on document switch", () => {
    const scroll = vi.fn();
    mountController(baseProps({ scrollTop: 0 }), { onScrollTopChange: scroll });
    const view = controller!.getView()!;
    // jsdom may not persist scrollTop; still verify a forced flush occurs once.
    Object.defineProperty(view.scrollDOM, "scrollTop", {
      configurable: true,
      get: () => 40,
      set: () => {},
    });

    controller!.update(
      baseProps({
        content: "document-b",
        documentId: "doc-b",
        scrollTop: 5,
      }),
    );

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith("doc-a", 40);
  });

  it("ignores late language loads after a newer document generation", async () => {
    mountController(baseProps({ language: "plaintext" }));
    const view = controller!.getView()!;
    const generationBefore = controller!.getDocumentGeneration();

    // Switch documents quickly; async language work from a prior generation must not apply.
    controller!.update(
      baseProps({
        content: "json-doc",
        documentId: "doc-json",
        language: "json",
      }),
    );
    const generationAfter = controller!.getDocumentGeneration();
    expect(generationAfter).toBeGreaterThan(generationBefore);

    controller!.update(
      baseProps({
        content: "plain-again",
        documentId: "doc-plain",
        language: "plaintext",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(controller!.getTrackedDocumentId()).toBe("doc-plain");
    expect(view.state.doc.toString()).toBe("plain-again");
  });

  it("destroy is idempotent and clears the pane session cache", () => {
    const { sessionCache } = mountController();
    controller!.update(
      baseProps({ content: "document-b", documentId: "doc-b" }),
    );
    expect(sessionCache.has({ paneId: "pane-1", documentId: "doc-a" })).toBe(true);

    controller!.destroy();
    controller!.destroy();
    expect(sessionCache.has({ paneId: "pane-1", documentId: "doc-a" })).toBe(false);
    expect(controller!.getView()).toBeUndefined();
    controller = undefined;
  });

  it("marks store-origin transactions so dirty sync can ignore them", () => {
    mountController();
    const view = controller!.getView()!;
    const tr = view.state.update({
      changes: { from: 0, to: 0, insert: "?" },
      annotations: [storeOriginAnnotation.of("sync")],
    });
    expect(transactionHasStoreOrigin([tr])).toBe(true);

    const userTr = view.state.update({
      changes: { from: 0, to: 0, insert: "!" },
      userEvent: "input",
    });
    expect(transactionHasStoreOrigin([userTr])).toBe(false);
  });

  it("reconfigures the completion compartment when autoClosePairs/autoSuggest change", () => {
    mountController();
    const view = controller!.getView()!;
    const compartments = controller!.getCompartments();
    const before = compartments.completion.get(view.state);

    // Flip autoClosePairs off and autoSuggest on.
    controller!.update(baseProps({ autoClosePairs: false, autoSuggest: true }));

    const after = compartments.completion.get(view.state);
    expect(after).not.toBe(before);
  });

  it("is idempotent when completion settings do not change", () => {
    mountController();
    const view = controller!.getView()!;
    const compartments = controller!.getCompartments();
    const before = compartments.completion.get(view.state);

    controller!.update(baseProps({ autoClosePairs: true, autoSuggest: false }));

    const after = compartments.completion.get(view.state);
    expect(after).toBe(before);
  });
});
