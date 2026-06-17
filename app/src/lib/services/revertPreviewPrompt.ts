/**
 * M2-T4 — registry-runner for the revert preview dialog, mirroring the
 * `entryNamePrompt` / `permissionPrompt` pattern. The handler awaits
 * `promptRevertPreview(...)`; the dialog component (mounted once in AppShell)
 * resolves it when the user confirms or cancels.
 */

export interface RevertPreviewRequest {
  /** Message the revert will undo back to. */
  messageId: string;
  /** Human-readable label for the target message (e.g. truncated body). */
  messageLabel: string;
  /** Unified diff of file changes the revert would undo, if available. */
  diff: string | null;
}

type RevertPreviewRunner = (request: RevertPreviewRequest) => Promise<boolean>;

let runner: RevertPreviewRunner | null = null;

export function registerRevertPreviewRunner(next: RevertPreviewRunner | null): void {
  runner = next;
}

/**
 * Returns `true` when the user confirmed the revert, `false` otherwise
 * (cancelled, dismissed, or no dialog mounted).
 */
export function promptRevertPreview(request: RevertPreviewRequest): Promise<boolean> {
  if (!runner) {
    // Without a mounted dialog, fall back to a plain confirm so the action
    // still works (e.g. in tests or minimal mounts).
    return Promise.resolve(
      window.confirm(
        `Revert this session back to "${request.messageLabel}"? File changes after this message will be undone.`,
      ),
    );
  }
  return runner(request);
}
