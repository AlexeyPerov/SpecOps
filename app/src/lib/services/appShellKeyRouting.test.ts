import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyboardEvent } from "../test/helpers";
import { keymapCommandForEvent } from "../commands/registry";
import {
  isAlwaysRunShellCommand,
  isTargetInCodeMirror,
  isTargetInEditable,
  isTargetInOrdinaryInput,
  resolveAppShellKeyRouting,
  SELECT_NEXT_OCCURRENCE_BINDING_DECISION,
} from "./appShellKeyRouting";
import { createAppShellCommandHandlers } from "./appShellPageHandlers";

vi.mock("../commands/registry", async () => {
  const actual = await vi.importActual<typeof import("../commands/registry")>(
    "../commands/registry",
  );
  return {
    ...actual,
    dispatchMenuCommand: vi.fn(),
  };
});

import { dispatchMenuCommand } from "../commands/registry";

const dispatchMenuCommandMock = vi.mocked(dispatchMenuCommand);

describe("resolveAppShellKeyRouting", () => {
  it("ignores key events while an overlay owns the keyboard", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "file.save",
        overlayOpen: true,
        targetInOrdinaryInput: false,
      }),
    ).toEqual({ action: "ignore", reason: "overlay-open" });
  });

  it("ignores events during IME composition", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "edit.duplicateLine",
        overlayOpen: false,
        targetInOrdinaryInput: false,
        composing: true,
      }),
    ).toEqual({ action: "ignore", reason: "ime-composing" });
  });

  it("ignores unmapped chords (browser/default layer)", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: null,
        overlayOpen: false,
        targetInOrdinaryInput: false,
      }),
    ).toEqual({ action: "ignore", reason: "no-command" });
  });

  it("runs editor-global commands even when focus is in an ordinary input", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "file.save",
        overlayOpen: false,
        targetInOrdinaryInput: true,
      }),
    ).toEqual({
      action: "run-command",
      commandId: "file.save",
      preventDefault: true,
    });
  });

  it("blocks non-global commands when focus is in a protected ordinary input", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "edit.duplicateLine",
        overlayOpen: false,
        targetInOrdinaryInput: true,
      }),
    ).toEqual({ action: "ignore", reason: "protected-input" });

    expect(
      resolveAppShellKeyRouting({
        commandId: "view.zoomIn",
        overlayOpen: false,
        targetInOrdinaryInput: true,
      }),
    ).toEqual({ action: "ignore", reason: "protected-input" });
  });

  it("runs non-global commands when focus is in CodeMirror (not ordinary input)", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "edit.duplicateLine",
        overlayOpen: false,
        targetInOrdinaryInput: false,
      }),
    ).toEqual({
      action: "run-command",
      commandId: "edit.duplicateLine",
      preventDefault: true,
    });
  });

  it("runs non-global commands when focus is not in an editable", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "edit.duplicateLine",
        overlayOpen: false,
        targetInOrdinaryInput: false,
      }),
    ).toEqual({
      action: "run-command",
      commandId: "edit.duplicateLine",
      preventDefault: true,
    });
  });

  it("always-run shell commands bypass the ordinary-input guard", () => {
    for (const commandId of [
      "app.toggleFindReplace",
      "app.findInProject",
      "app.replaceInProject",
    ] as const) {
      expect(isAlwaysRunShellCommand(commandId)).toBe(true);
      expect(
        resolveAppShellKeyRouting({
          commandId,
          overlayOpen: false,
          targetInOrdinaryInput: true,
          alwaysRunWhenMapped: true,
        }),
      ).toEqual({
        action: "run-command",
        commandId,
        preventDefault: true,
      });
    }
  });

  it("encodes target precedence: overlay beats always-run and globals", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "app.toggleFindReplace",
        overlayOpen: true,
        targetInOrdinaryInput: false,
        alwaysRunWhenMapped: true,
      }),
    ).toEqual({ action: "ignore", reason: "overlay-open" });
  });
});

describe("SELECT_NEXT_OCCURRENCE_BINDING_DECISION (M2)", () => {
  it("records Cmd/Ctrl+D move from duplicateLine to select-next without changing bindings now", () => {
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.currentOwner).toBe(
      "edit.duplicateLine",
    );
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.futureOwner).toBe(
      "edit.selectNextOccurrence",
    );
    expect(SELECT_NEXT_OCCURRENCE_BINDING_DECISION.duplicateLineNeedsNewDefault).toBe(
      true,
    );
    expect(keymapCommandForEvent(keyboardEvent({ key: "d", metaKey: true }))).toBe(
      "edit.duplicateLine",
    );
  });
});

describe("editable target helpers", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("detects ordinary inputs and non-CM contenteditable", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    expect(isTargetInOrdinaryInput(editable)).toBe(true);
    expect(isTargetInEditable(editable)).toBe(true);
    expect(isTargetInCodeMirror(editable)).toBe(false);

    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isTargetInOrdinaryInput(input)).toBe(true);

    const plain = document.createElement("div");
    document.body.appendChild(plain);
    expect(isTargetInOrdinaryInput(plain)).toBe(false);
  });

  it("treats CodeMirror hosts as editor focus, not ordinary input", () => {
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("contenteditable", "true");
    cm.appendChild(content);
    document.body.appendChild(cm);

    expect(isTargetInCodeMirror(content)).toBe(true);
    expect(isTargetInOrdinaryInput(content)).toBe(false);
    expect(isTargetInEditable(content)).toBe(true);
  });
});

describe("createAppShellCommandHandlers.handleKeydown", () => {
  let overlayOpen = false;

  beforeEach(() => {
    dispatchMenuCommandMock.mockReset();
    document.body.replaceChildren();
    overlayOpen = false;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  function createHandlers() {
    return createAppShellCommandHandlers({
      notify: () => {},
      getSnapshot: () => ({}) as never,
      getCurrentWindowId: () => "win-1",
      getEditorRunner: () => null,
      getOverlayOpen: () => overlayOpen,
      openProjectSearch: () => {},
      setConsoleOpen: () => {},
    });
  }

  function keyEvent(
    partial: Parameters<typeof keyboardEvent>[0],
    target?: HTMLElement,
  ): KeyboardEvent {
    const event = keyboardEvent(partial);
    const preventDefault = vi.fn();
    Object.defineProperty(event, "preventDefault", {
      value: preventDefault,
      configurable: true,
    });
    if (target) {
      Object.defineProperty(event, "target", { value: target, configurable: true });
    }
    return event;
  }

  it("runs a global command from a non-editable target", () => {
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "s", metaKey: true });
    handleKeydown(event);
    expect(dispatchMenuCommandMock).toHaveBeenCalledWith(
      "file.save",
      expect.any(Object),
    );
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("runs editor-global save while focus is in an ordinary input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "s", metaKey: true }, input);
    handleKeydown(event);
    expect(dispatchMenuCommandMock).toHaveBeenCalledWith(
      "file.save",
      expect.any(Object),
    );
  });

  it("does not run non-global commands while focus is in ordinary contenteditable", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "d", metaKey: true }, editable);
    handleKeydown(event);
    expect(dispatchMenuCommandMock).not.toHaveBeenCalled();
  });

  it("runs editor app commands while focus is in CodeMirror", () => {
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    content.setAttribute("contenteditable", "true");
    cm.appendChild(content);
    document.body.appendChild(cm);

    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "d", metaKey: true }, content);
    handleKeydown(event);
    expect(dispatchMenuCommandMock).toHaveBeenCalledWith(
      "edit.duplicateLine",
      expect.any(Object),
    );
  });

  it("ignores mapped commands while a modal overlay is open", () => {
    overlayOpen = true;
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "s", metaKey: true });
    handleKeydown(event);
    expect(dispatchMenuCommandMock).not.toHaveBeenCalled();
  });

  it("runs find/replace even when focus is in an input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "f", metaKey: true }, input);
    handleKeydown(event);
    expect(dispatchMenuCommandMock).toHaveBeenCalledWith(
      "app.toggleFindReplace",
      expect.any(Object),
    );
  });

  it("does not dispatch when the chord is unmapped", () => {
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "q", metaKey: true, shiftKey: true });
    handleKeydown(event);
    expect(dispatchMenuCommandMock).not.toHaveBeenCalled();
  });
});
