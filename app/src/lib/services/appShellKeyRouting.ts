import type { AppCommandId } from "../domain/contracts";
import { isEditorGlobalCommand } from "../commands/registry";
import { SELECT_NEXT_OCCURRENCE_BINDING_DECISION } from "../types/editor";

/**
 * Keyboard routing layers for the app shell (target precedence for M0.2+):
 *   1. active modal / picker / overlay
 *   2. focused editor CodeMirror keymap (editor-local)
 *   3. permitted global / editor-global app command
 *   4. browser / default behavior
 *
 * M0.1 characterizes current production behavior and documents the target.
 * Overlay gating is encoded here for tests; production still passes
 * `overlayOpen: false` until M0.2 wires overlay ownership.
 */

export type AppShellKeyRoutingDecision =
  | {
      action: "ignore";
      reason: "overlay-open" | "no-command" | "protected-input";
    }
  | {
      action: "run-command";
      commandId: AppCommandId;
      preventDefault: true;
    };

export type AppShellKeyRoutingInput = {
  commandId: AppCommandId | null;
  /** True when a modal, picker, or dialog should own Escape / chords. */
  overlayOpen: boolean;
  /**
   * True when the event target is inside `input`, `textarea`, or
   * `[contenteditable=true]` (CodeMirror's `.cm-content` matches this today).
   */
  targetInEditable: boolean;
  /**
   * Commands that always run even when the target is an editable
   * (find/replace and project search chords).
   */
  alwaysRunWhenMapped?: boolean;
};

/**
 * Resolve what the app-shell window keydown handler should do.
 * Does not mutate the event; callers apply preventDefault / runCommand.
 */
export function resolveAppShellKeyRouting(
  input: AppShellKeyRoutingInput,
): AppShellKeyRoutingDecision {
  const { commandId, overlayOpen, targetInEditable, alwaysRunWhenMapped = false } =
    input;

  if (overlayOpen) {
    return { action: "ignore", reason: "overlay-open" };
  }

  if (!commandId) {
    return { action: "ignore", reason: "no-command" };
  }

  if (alwaysRunWhenMapped) {
    return { action: "run-command", commandId, preventDefault: true };
  }

  if (targetInEditable && !isEditorGlobalCommand(commandId)) {
    // Current production: treating CodeMirror as contenteditable blocks
    // non-global app commands (including edit.*). Editor-native CM keymaps
    // still handle their own chords. M0.2 will distinguish CM focus so
    // permitted editor app commands can run while ordinary inputs stay protected.
    return { action: "ignore", reason: "protected-input" };
  }

  return { action: "run-command", commandId, preventDefault: true };
}

/** Find/replace and project-search chords bypass the editable guard today. */
export function isAlwaysRunShellCommand(commandId: AppCommandId): boolean {
  return (
    commandId === "app.toggleFindReplace" ||
    commandId === "app.findInProject" ||
    commandId === "app.replaceInProject"
  );
}

export function isTargetInEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, [contenteditable=true]"));
}

/** Re-export for tests and M2 planning without pulling the full editor types. */
export { SELECT_NEXT_OCCURRENCE_BINDING_DECISION };
