/**
 * M3 (R4) — promise-based in-app confirm API.
 *
 * Services and components call `requestConfirm(...)` and await a boolean.
 * A self-registering dialog host (`ConfirmDialog.svelte`, mounted once in
 * `AppShell`) supplies the runner; until one is registered (or after it
 * unmounts) the prompt falls back to `window.confirm` so the action still
 * works in minimal mounts and tests.
 *
 * Single-flight: when a new request arrives while another is pending, the
 * pending one is resolved with `false` (cancelled) and the new request
 * takes over the dialog. Two confirms never render at once.
 */

export interface ConfirmRequest {
  /** Dialog title. Defaults to "Confirm". */
  title?: string;
  /** Body message (required). */
  message: string;
  /** Primary action label. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Cancel action label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, the primary button uses danger styling. */
  danger?: boolean;
}

type ConfirmRunner = (request: ConfirmRequest) => Promise<boolean>;

let runner: ConfirmRunner | null = null;

export function registerConfirmRunner(next: ConfirmRunner | null): void {
  runner = next;
}

/**
 * Resolve `true` when the user confirms, `false` when they cancel or dismiss.
 * Falls back to `window.confirm` when no dialog host is registered.
 */
export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  if (!runner) {
    return Promise.resolve(window.confirm(request.message));
  }
  return runner(request);
}

/**
 * Convenience wrapper for the common yes/no case with just a message.
 */
export function confirmDialog(message: string, danger = false): Promise<boolean> {
  return requestConfirm({ message, danger });
}
