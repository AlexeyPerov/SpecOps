import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keyboardEvent } from "../test/helpers";
import { keymapCommandForEvent } from "../commands/registry";
import {
  isAlwaysRunShellCommand,
  isTargetInEditable,
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
        targetInEditable: false,
      }),
    ).toEqual({ action: "ignore", reason: "overlay-open" });
  });

  it("ignores unmapped chords (browser/default layer)", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: null,
        overlayOpen: false,
        targetInEditable: false,
      }),
    ).toEqual({ action: "ignore", reason: "no-command" });
  });

  it("runs editor-global commands even when focus is in an ordinary input", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "file.save",
        overlayOpen: false,
        targetInEditable: true,
      }),
    ).toEqual({
      action: "run-command",
      commandId: "file.save",
      preventDefault: true,
    });
  });

  it("blocks non-global commands when focus is in a protected editable", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "edit.duplicateLine",
        overlayOpen: false,
        targetInEditable: true,
      }),
    ).toEqual({ action: "ignore", reason: "protected-input" });

    expect(
      resolveAppShellKeyRouting({
        commandId: "view.zoomIn",
        overlayOpen: false,
        targetInEditable: true,
      }),
    ).toEqual({ action: "ignore", reason: "protected-input" });
  });

  it("runs non-global commands when focus is not in an editable", () => {
    expect(
      resolveAppShellKeyRouting({
        commandId: "edit.duplicateLine",
        overlayOpen: false,
        targetInEditable: false,
      }),
    ).toEqual({
      action: "run-command",
      commandId: "edit.duplicateLine",
      preventDefault: true,
    });
  });

  it("always-run shell commands bypass the editable guard", () => {
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
          targetInEditable: true,
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
        targetInEditable: false,
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

describe("isTargetInEditable", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("detects input, textarea, and contenteditable (CodeMirror-style) hosts", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    expect(isTargetInEditable(editable)).toBe(true);

    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(isTargetInEditable(input)).toBe(true);

    const plain = document.createElement("div");
    document.body.appendChild(plain);
    expect(isTargetInEditable(plain)).toBe(false);
  });
});

describe("createAppShellCommandHandlers.handleKeydown", () => {
  beforeEach(() => {
    dispatchMenuCommandMock.mockReset();
    document.body.replaceChildren();
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

  it("does not run non-global commands while focus is in contenteditable", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);
    const { handleKeydown } = createHandlers();
    const event = keyEvent({ key: "d", metaKey: true }, editable);
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
