/**
 * Gates OpenCode sidecar attach until an explicit workspace lifecycle event
 * (user adds/opens/switches workspace), not passive session restore on app launch.
 */

let workspaceLifecycleActive = false;

/** Resets lifecycle gate (tests). */
export function resetWorkspaceLifecycleForTests(): void {
  workspaceLifecycleActive = false;
}

export function isWorkspaceLifecycleActive(): boolean {
  return workspaceLifecycleActive;
}

export function markWorkspaceLifecycleActive(): void {
  workspaceLifecycleActive = true;
}
