import type { ContextId } from "../domain/contracts";
import { appState } from "../state/appState";
import { isGitIntegrationEnabled } from "./gitIntegrationSettings";
import { markWorkspaceLifecycleActive } from "./workspaceLifecycle";

export const GIT_INTEGRATION_DISABLED_NOTIFY =
  "Git integration is disabled in Settings. Enable it under Settings → Version Control.";

export const NO_WORKSPACE_FOR_VERSION_CONTROL_NOTIFY =
  "Open a workspace to use Version Control.";

export function isWorkspaceContextId(contextId: ContextId): boolean {
  return contextId.startsWith("ws-");
}

/**
 * Switches to the workspace (when needed) and opens or focuses its
 * version-control view tab. Returns true when the tab was opened or focused;
 * returns false and notifies when git integration is off or the target is not
 * a workspace context.
 */
export function openVersionControlForWorkspace(
  workspaceId: ContextId,
  notify?: (message: string) => void,
): boolean {
  if (!isGitIntegrationEnabled(appState.getSnapshot().settings.gitIntegration)) {
    notify?.(GIT_INTEGRATION_DISABLED_NOTIFY);
    return false;
  }
  if (!isWorkspaceContextId(workspaceId)) {
    notify?.(NO_WORKSPACE_FOR_VERSION_CONTROL_NOTIFY);
    return false;
  }
  const switched = appState.switchContext(workspaceId);
  if (switched) {
    markWorkspaceLifecycleActive();
  }
  appState.openOrFocusViewTab("version-control");
  return true;
}

/**
 * Commit the Version Control view should select when it next renders for this
 * repository. Set by the "Git Log" popup so picking a commit there lands on it
 * in the full view; consumed once, by the first view that asks for it.
 */
let pendingCommitSelection: { repoRoot: string; sha: string } | null = null;
/**
 * Mounted Version Control views. A view that is already open for the target
 * repository never re-probes when its tab is re-focused, so it is notified
 * directly instead of waiting for a probe to pick the handoff up.
 */
const commitSelectionListeners = new Set<() => void>();

/** Subscribe a mounted Version Control view to commit handoffs. */
export function subscribeVersionControlCommitRequests(listener: () => void): () => void {
  commitSelectionListeners.add(listener);
  return () => {
    commitSelectionListeners.delete(listener);
  };
}

/**
 * Switch to the workspace's Version Control view with `sha` selected.
 * `repoRoot` scopes the handoff so a view for another repository cannot pick
 * up a selection meant for this one.
 */
export function openVersionControlAtCommit(
  workspaceId: ContextId,
  repoRoot: string,
  sha: string,
  notify?: (message: string) => void,
): boolean {
  pendingCommitSelection = { repoRoot, sha };
  const opened = openVersionControlForWorkspace(workspaceId, notify);
  if (!opened) {
    pendingCommitSelection = null;
    return false;
  }
  for (const listener of commitSelectionListeners) {
    listener();
  }
  return true;
}

/**
 * Take the pending commit selection for `repoRoot`, if any. Returns null when
 * nothing is pending or the request was for a different repository.
 */
export function takePendingVersionControlCommit(repoRoot: string | null): string | null {
  if (!pendingCommitSelection || !repoRoot) {
    return null;
  }
  if (pendingCommitSelection.repoRoot !== repoRoot) {
    return null;
  }
  const { sha } = pendingCommitSelection;
  pendingCommitSelection = null;
  return sha;
}

/** Test helper: drop any pending commit handoff and its listeners. */
export function resetPendingVersionControlCommitForTests(): void {
  pendingCommitSelection = null;
  commitSelectionListeners.clear();
}

/** Opens Version Control for the active context (command / shortcut entry). */
export function openVersionControlForActiveContext(
  notify?: (message: string) => void,
): boolean {
  return openVersionControlForWorkspace(appState.getActiveContext().id, notify);
}
