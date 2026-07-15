import { describe, expect, it, vi } from "vitest";
import {
  createEditorToolController,
  type EditorToolBinding,
} from "./editorToolController";

function createController(overrides?: {
  binding?: EditorToolBinding | null;
  modalOpen?: boolean;
  focusEditor?: () => void;
}) {
  let binding: EditorToolBinding | null =
    overrides?.binding === undefined
      ? { paneId: "pane-1", documentId: "doc-1" }
      : overrides.binding;
  let modalOpen = overrides?.modalOpen ?? false;
  const focusEditor = overrides?.focusEditor ?? vi.fn();

  const controller = createEditorToolController({
    getActiveBinding: () => binding,
    focusEditor,
    isModalOpen: () => modalOpen,
  });

  return {
    controller,
    focusEditor,
    setBinding: (next: EditorToolBinding | null) => {
      binding = next;
    },
    setModalOpen: (open: boolean) => {
      modalOpen = open;
    },
  };
}

describe("createEditorToolController", () => {
  it("opens one tool at a time and switches between find and go-to", () => {
    const { controller } = createController();

    controller.open("find");
    expect(controller.getSnapshot().activeTool).toBe("find");

    controller.open("go-to");
    expect(controller.getSnapshot().activeTool).toBe("go-to");
    expect(controller.getSnapshot().binding).toEqual({
      paneId: "pane-1",
      documentId: "doc-1",
    });
  });

  it("toggles the same tool closed and restores editor focus", () => {
    const { controller, focusEditor } = createController();

    controller.toggle("find");
    expect(controller.getSnapshot().activeTool).toBe("find");

    controller.toggle("find");
    expect(controller.getSnapshot().activeTool).toBe(null);
    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it("refuses to open when a modal is open", () => {
    const { controller } = createController({ modalOpen: true });

    controller.open("find");
    expect(controller.getSnapshot().activeTool).toBe(null);
  });

  it("closes without restoring focus when a modal takes precedence", () => {
    const { controller, focusEditor, setModalOpen } = createController();

    controller.open("find");
    setModalOpen(true);
    controller.syncToEnvironment();

    expect(controller.getSnapshot().activeTool).toBe(null);
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it("closes when pane/document binding becomes stale", () => {
    const { controller, focusEditor, setBinding } = createController();

    controller.open("go-to");
    setBinding({ paneId: "pane-1", documentId: "doc-2" });
    controller.syncToEnvironment();

    expect(controller.getSnapshot().activeTool).toBe(null);
    expect(controller.getSnapshot().binding).toBe(null);
    expect(focusEditor).not.toHaveBeenCalled();
  });

  it("does not open without an active document binding", () => {
    const { controller } = createController({ binding: null });

    controller.open("find");
    expect(controller.getSnapshot().activeTool).toBe(null);
  });

  it("keeps find/go-to field state across open/close", () => {
    const { controller } = createController();

    controller.setFindQuery("hello");
    controller.setFindReplace("world");
    controller.setFindCaseSensitive(true);
    controller.setFindWholeWord(true);
    controller.setFindRegexp(true);
    controller.setGoToLineValue("42");
    controller.open("find");
    controller.close();

    const snapshot = controller.getSnapshot();
    expect(snapshot.find).toEqual({
      query: "hello",
      replace: "world",
      caseSensitive: true,
      wholeWord: true,
      regexp: true,
    });
    expect(snapshot.goToLineValue).toBe("42");
    expect(snapshot.activeTool).toBe(null);
  });

  it("notifies subscribers and supports Escape-style close with focus restore", () => {
    const { controller, focusEditor } = createController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    expect(listener).toHaveBeenCalledTimes(1);
    controller.open("find");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.at(-1)?.[0].activeTool).toBe("find");

    controller.close({ restoreFocus: true });
    expect(focusEditor).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.open("go-to");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("ignores operations after dispose", () => {
    const { controller } = createController();
    controller.open("find");
    controller.dispose();
    controller.open("go-to");
    expect(controller.getSnapshot().activeTool).toBe(null);
  });
});
