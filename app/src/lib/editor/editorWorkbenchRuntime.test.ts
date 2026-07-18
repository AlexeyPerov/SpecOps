import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorHost, EditorHostIdentity } from "../types/editor";
import type { ContextId } from "../domain/contracts";
import { createEditorWorkbenchRuntime } from "./editorWorkbenchRuntime";

/**
 * Build a test host. `contextId` defaults to "notepad" so existing tests that
 * don't care about cross-context behavior stay terse; tests that exercise
 * context namespacing pass an explicit contextId.
 */
function makeHost(
  identity: Omit<EditorHostIdentity, "contextId"> & { contextId?: ContextId },
  label = "host",
): EditorHost {
  const fullIdentity: EditorHostIdentity = {
    contextId: identity.contextId ?? "notepad",
    paneId: identity.paneId,
    documentId: identity.documentId,
    generation: identity.generation,
  };
  return makeHostWithIdentity(fullIdentity, label);
}

function makeHostWithIdentity(identity: EditorHostIdentity, label = "host"): EditorHost {
  return {
    identity,
    actions: {
      history: {
        undo: () => ({ ok: true }),
        redo: () => ({ ok: true }),
      },
      selection: {
        indent: () => ({ ok: true }),
        outdent: () => ({ ok: true }),
        selectNextOccurrence: () => ({ ok: true }),
        selectAllOccurrences: () => ({ ok: true }),
        skipOccurrence: () => ({ ok: true }),
        undoOccurrence: () => ({ ok: true }),
      },
      lines: {
        moveLineUp: () => ({ ok: true }),
        moveLineDown: () => ({ ok: true }),
        duplicateLine: () => ({ ok: true }),
        joinLines: () => ({ ok: true }),
      },
      navigation: {
        goToLine: () => ({ ok: true }),
        jumpToHeading: () => ({ ok: true }),
      },
      search: {
        findNext: () => ({ ok: true }),
        findPrevious: () => ({ ok: true }),
        replaceCurrent: () => ({ ok: true }),
        replaceAndFindNext: () => ({ ok: true }),
        replaceAll: () => ({ ok: true, value: 0 }),
        setSearchQuery: () => ({ ok: true }),
      },
      view: {
        setWrap: () => ({ ok: true }),
        setZoom: () => ({ ok: true }),
      },
      folding: {
        toggle: () => ({ ok: true }),
        fold: () => ({ ok: true }),
        unfold: () => ({ ok: true }),
        foldAll: () => ({ ok: true }),
        unfoldAll: () => ({ ok: true }),
      },
      completion: {
        trigger: () => ({ ok: true }),
      },
      snippets: {
        insert: () => ({ ok: true }),
      },
      bookmarks: {
        toggle: () => ({ ok: true }),
        next: () => ({ ok: true }),
        previous: () => ({ ok: true }),
        clearAll: () => ({ ok: true }),
      },
    },
    queries: {
      history: {
        canUndo: () => ({ ok: true, value: false }),
        canRedo: () => ({ ok: true, value: false }),
      },
      selection: {
        getSelection: () => ({
          ok: true,
          value: { from: 0, to: 0, head: 0, empty: true },
        }),
      },
      document: {
        getDocumentContent: () => ({ ok: true, value: label }),
      },
      search: {
        getMatchInfo: () => ({ ok: true, value: { total: 0, current: 0 } }),
      },
      markdown: {
        getHeadings: () => ({ ok: true, value: [] }),
        getActiveHeadingKey: () => ({ ok: true, value: null }),
        isHeadingFolded: () => ({ ok: true, value: false }),
      },
      bookmarks: {
        list: () => ({ ok: true, value: [] }),
      },
    },
    capability: () => ({ state: "available" }),
    focus: vi.fn(),
  };
}

describe("createEditorWorkbenchRuntime", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("resolves the active host by pane and document identity", () => {
    let activePaneId = "pane-a";
    let activeDocumentId: string | null = "doc-1";
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => activePaneId,
      getActiveDocumentId: () => activeDocumentId,
    });
    dispose = () => runtime.dispose();

    const hostA = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }, "a");
    const hostB = makeHost({ paneId: "pane-b", documentId: "doc-2", generation: 1 }, "b");
    runtime.registerHost(hostA);
    runtime.registerHost(hostB);

    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "a",
    });

    activePaneId = "pane-b";
    activeDocumentId = "doc-2";
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "b",
    });
  });

  it("rejects late registration from an older generation of the same document", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-1",
    });
    dispose = () => runtime.dispose();

    const newer = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 2 }, "newer");
    const older = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }, "older");
    runtime.registerHost(newer);
    const rejected = runtime.registerHost(older);

    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "newer",
    });

    rejected.unregister();
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "newer",
    });
  });

  it("keeps multiple documents in the same pane coexisting (tab keep-alive)", () => {
    let activeDocumentId: string | null = "doc-1";
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => activeDocumentId,
    });
    dispose = () => runtime.dispose();

    const hostOne = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }, "one");
    const hostTwo = makeHost({ paneId: "pane-a", documentId: "doc-2", generation: 1 }, "two");
    runtime.registerHost(hostOne);
    runtime.registerHost(hostTwo);

    // Both hosts are live; switching the active document surfaces the right one.
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "one",
    });
    activeDocumentId = "doc-2";
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "two",
    });
    // Going back to the first document still works (its host was retained).
    activeDocumentId = "doc-1";
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "one",
    });
  });

  it("does not clear a newer host when an older registration unregisters", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-2",
    });
    dispose = () => runtime.dispose();

    const first = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }, "first");
    const firstReg = runtime.registerHost(first);
    const second = makeHost({ paneId: "pane-a", documentId: "doc-2", generation: 2 }, "second");
    runtime.registerHost(second);

    firstReg.unregister();

    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "second",
    });
  });

  it("makes unregister idempotent", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-1",
    });
    dispose = () => runtime.dispose();

    const host = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 });
    const reg = runtime.registerHost(host);
    reg.unregister();
    reg.unregister();
    expect(runtime.getActiveHost()).toBeNull();
  });

  it("returns null when the active document does not match the registered host", () => {
    let activeDocumentId: string | null = "doc-1";
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => activeDocumentId,
    });
    dispose = () => runtime.dispose();

    runtime.registerHost(
      makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }, "doc-1"),
    );
    activeDocumentId = "doc-2";
    expect(runtime.getActiveHost()).toBeNull();
  });

  it("publishes cursor status only for the active matching host", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-1",
    });
    dispose = () => runtime.dispose();

    const identityA: EditorHostIdentity = {
      contextId: "notepad",
      paneId: "pane-a",
      documentId: "doc-1",
      generation: 1,
    };
    const identityB: EditorHostIdentity = {
      contextId: "notepad",
      paneId: "pane-b",
      documentId: "doc-2",
      generation: 1,
    };
    runtime.registerHost(makeHost(identityA));
    runtime.registerHost(makeHost(identityB));

    const listener = vi.fn();
    const unsubscribe = runtime.subscribeCursorStatus(listener);

    runtime.publishCursorStatus(identityB, 9, 2, 1);
    expect(listener).not.toHaveBeenCalled();

    runtime.publishCursorStatus(identityA, 3, 4, 1);
    expect(listener).toHaveBeenCalledWith({
      identity: identityA,
      line: 3,
      column: 4,
      selectionCount: 1,
    });

    unsubscribe();
    runtime.publishCursorStatus(identityA, 5, 6, 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes selection count for multi-cursor", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-1",
    });
    dispose = () => runtime.dispose();

    const identity: EditorHostIdentity = {
      contextId: "notepad",
      paneId: "pane-a",
      documentId: "doc-1",
      generation: 1,
    };
    runtime.registerHost(makeHost(identity));

    const listener = vi.fn();
    runtime.subscribeCursorStatus(listener);

    runtime.publishCursorStatus(identity, 5, 3, 4);
    expect(listener).toHaveBeenCalledWith({
      identity,
      line: 5,
      column: 3,
      selectionCount: 4,
    });
  });

  it("dispose clears hosts and ignores further registrations", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-1",
    });
    runtime.registerHost(
      makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }),
    );
    runtime.dispose();
    dispose = undefined;

    expect(runtime.getActiveHost()).toBeNull();
    runtime.registerHost(
      makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 2 }),
    );
    expect(runtime.getActiveHost()).toBeNull();
  });

  it("exposes an active command runner for find/go-to style callers", () => {
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => "notepad",
      getActivePaneId: () => "pane-a",
      getActiveDocumentId: () => "doc-1",
    });
    dispose = () => runtime.dispose();

    const host = makeHost({ paneId: "pane-a", documentId: "doc-1", generation: 1 }, "body");
    const goToLine = vi.fn(() => ({ ok: true as const }));
    host.actions.navigation.goToLine = goToLine;
    runtime.registerHost(host);

    const runner = runtime.getActiveRunner();
    expect(runner).not.toBeNull();
    expect(runner?.goToLine(12)).toBe(true);
    expect(goToLine).toHaveBeenCalledWith(12);
  });

  it("keeps hosts from different contexts with overlapping pane/document ids separate", () => {
    // Two contexts (e.g. two workspaces restored from disk) can both have
    // pane-1/doc-1. Without contextId namespacing the second register would
    // clobber the first and getActiveHost could return the wrong context's host.
    let activeContextId: ContextId = "ws-1";
    let activeDocumentId: string | null = "doc-1";
    const runtime = createEditorWorkbenchRuntime({
      getActiveContextId: () => activeContextId,
      getActivePaneId: () => "pane-1",
      getActiveDocumentId: () => activeDocumentId,
    });
    dispose = () => runtime.dispose();

    const hostA = makeHost(
      { contextId: "ws-1", paneId: "pane-1", documentId: "doc-1", generation: 1 },
      "workspace-a",
    );
    const hostB = makeHost(
      { contextId: "ws-2", paneId: "pane-1", documentId: "doc-1", generation: 1 },
      "workspace-b",
    );
    runtime.registerHost(hostA);
    runtime.registerHost(hostB);

    // Both hosts are live; each context resolves its own.
    activeContextId = "ws-1";
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "workspace-a",
    });
    activeContextId = "ws-2";
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "workspace-b",
    });
    // Switching back still resolves correctly (no clobbering).
    activeContextId = "ws-1";
    expect(runtime.getActiveHost()?.queries.document.getDocumentContent()).toEqual({
      ok: true,
      value: "workspace-a",
    });
  });
});
