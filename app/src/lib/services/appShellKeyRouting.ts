import type { AppCommandId } from "../domain/contracts";
import { isEditorGlobalCommand } from "../commands/registry";
import { SELECT_NEXT_OCCURRENCE_BINDING_DECISION } from "../types/editor";

/**
 * Keyboard routing layers for the app shell:
 *   1. active modal / picker / overlay
 *   2. editor overlay (find/replace, go-to) — focus in their inputs uses ordinary-input guard
 *   3. focused CodeMirror keymap (editor-local; app commands still resolve via workbench)
 *   4. permitted global / editor-global app command
 *   5. browser / default behavior
 *
 * Ordinary inputs and IME composition stay protected; CodeMirror `.cm-content`
 * is not treated as a protected ordinary input so app editor commands can run.
 */

export type AppShellKeyRoutingDecision =
  | {
      action: "ignore";
      reason:
        | "overlay-open"
        | "no-command"
        | "protected-input"
        | "ime-composing";
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
   * True when focus is in an ordinary `input` / `textarea` / `select` /
   * non-CodeMirror contenteditable — not inside `.cm-editor`.
   */
  targetInOrdinaryInput: boolean;
  /** True while an IME composition session is active. */
  composing?: boolean;
  /**
   * Commands that always run even when the target is an ordinary editable
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
  const {
    commandId,
    overlayOpen,
    targetInOrdinaryInput,
    composing = false,
    alwaysRunWhenMapped = false,
  } = input;

  if (overlayOpen) {
    return { action: "ignore", reason: "overlay-open" };
  }

  if (composing) {
    return { action: "ignore", reason: "ime-composing" };
  }

  if (!commandId) {
    return { action: "ignore", reason: "no-command" };
  }

  if (alwaysRunWhenMapped) {
    return { action: "run-command", commandId, preventDefault: true };
  }

  if (targetInOrdinaryInput && !isEditorGlobalCommand(commandId)) {
    return { action: "ignore", reason: "protected-input" };
  }

  return { action: "run-command", commandId, preventDefault: true };
}

/** Find/replace and project-search chords bypass the ordinary-input guard. */
export function isAlwaysRunShellCommand(commandId: AppCommandId): boolean {
  return (
    commandId === "app.toggleFindReplace" ||
    commandId === "app.findInProject" ||
    commandId === "app.replaceInProject"
  );
}

/** True when the event target is inside a CodeMirror editor host. */
export function isTargetInCodeMirror(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(".cm-editor"));
}

/**
 * Ordinary inputs that should block non-global app commands.
 * CodeMirror contenteditable is excluded so editor app commands can run.
 */
export function isTargetInOrdinaryInput(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (isTargetInCodeMirror(target)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
}

/**
 * @deprecated Prefer `isTargetInOrdinaryInput` + `isTargetInCodeMirror`.
 * Kept for characterization of the broader editable surface (includes CM).
 */
export function isTargetInEditable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
}

/** Re-export for tests and M2 planning without pulling the full editor types. */
export { SELECT_NEXT_OCCURRENCE_BINDING_DECISION };
