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

/** Opens Version Control for the active context (command / shortcut entry). */
export function openVersionControlForActiveContext(
  notify?: (message: string) => void,
): boolean {
  return openVersionControlForWorkspace(appState.getActiveContext().id, notify);
}
