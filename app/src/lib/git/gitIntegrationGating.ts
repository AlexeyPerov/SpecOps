import type {
  GitIntegrationScope,
  GitIntegrationSettings,
} from "../domain/contracts";
import {
  paneActiveTab,
  type EditorLayout,
  type EditorPane,
} from "../domain/editorLayout";
import { isViewTab } from "../domain/document";
import { appState } from "../state/appState";
import {
  isBackgroundGitAllowed,
  isGitIntegrationEnabled,
  resolveGitScope,
  shouldAutosaveBeforeGitOperations,
  shouldShowProjectTreeGitBadges,
  shouldShowWorkspaceManagerGitColumn,
} from "../services/gitIntegrationSettings";

/**
 * P03-08-T1 — caller-declared scope for a single {@link runGit} invocation.
 *
 * - `"versionControl"`: the call originates from the Version Control view (or
 *   an action the user took there, like a remote operation). Always allowed
 *   while git is enabled, regardless of {@link GitIntegrationSettings.scope}.
 * - `"background"`: the call originates from background UI (project-tree
 *   badges, Workspace Manager git column, file-status tracker). Blocked when
 *   scope is `"versionControlOnly"` or `"off"`, unless a VC tab is currently
 *   active in some pane (the user is looking at VC, so background refreshes
 *   are expected to keep it consistent).
 */
export type GitCallScope = "versionControl" | "background";

/** Read the current git-integration settings snapshot from app state. */
export function readGitIntegrationSettings(): GitIntegrationSettings {
  return appState.getSnapshot().settings.gitIntegration;
}

/** Whether git integration is enabled (master toggle, honoring `scope: "off"`). */
export function isGitIntegrationEnabledInApp(): boolean {
  return isGitIntegrationEnabled(readGitIntegrationSettings());
}

/**
 * P03-08-T1 — whether the active tab of any pane in any context is the
 * Version Control view. Used to decide whether background git callers may
 * proceed under `scope: "versionControlOnly"` (the user is actively looking
 * at VC, so badges/column refreshes are expected and not "git outside VC").
 *
 * Walks every context (notepad and each workspace) and every pane.
 */
export function isVersionControlViewActiveInAnyPane(): boolean {
  const { contexts } = appState.getSnapshot();
  const layouts: EditorLayout[] = [
    contexts.notepad.session.editorLayout,
    ...contexts.workspaces.map((workspace) => workspace.snapshot.session.editorLayout),
  ];
  for (const layout of layouts) {
    for (const pane of layout.panes) {
      if (paneHasVersionControlActiveTab(pane, layout)) {
        return true;
      }
    }
  }
  return false;
}

function paneHasVersionControlActiveTab(pane: EditorPane, layout: EditorLayout): boolean {
  const active = paneActiveTab(layout, pane.id);
  return Boolean(active && isViewTab(active) && active.view === "version-control");
}

/**
 * P03-08-T1 — decide whether a git call with the given caller scope may run
 * under the user's configured scope.
 */
export function shouldRunGitForScope(
  scope: GitIntegrationScope,
  callerScope: GitCallScope,
): boolean {
  if (scope === "off") {
    return false;
  }
  if (scope === "always") {
    return true;
  }
  // scope === "versionControlOnly": VC-initiated calls always run; background
  // calls run only while a VC tab is active in some pane (so the user looking
  // at VC still gets fresh badges/column).
  if (callerScope === "versionControl") {
    return true;
  }
  return isVersionControlViewActiveInAnyPane();
}

/** Whether project-tree git badges should load. */
export function shouldLoadProjectTreeGitBadges(): boolean {
  return shouldShowProjectTreeGitBadges(readGitIntegrationSettings());
}

/** Whether the Workspace Manager git column should load. */
export function shouldLoadWorkspaceManagerGitColumn(): boolean {
  return shouldShowWorkspaceManagerGitColumn(readGitIntegrationSettings());
}

/** Whether background git (badges/column) is allowed at all — only when scope is `"always"`. */
export function isBackgroundGitAllowedInApp(): boolean {
  return isBackgroundGitAllowed(readGitIntegrationSettings());
}

/** Whether autosave should run before git mutations. */
export function shouldRunAutosaveBeforeGitOperations(): boolean {
  return shouldAutosaveBeforeGitOperations(readGitIntegrationSettings());
}

/**
 * P03-08-T1 — effective gate for a {@link runGit} call with the given caller
 * scope. Combines the master `enabled` toggle (via {@link resolveGitScope})
 * with {@link shouldRunGitForScope}. Centralizes the "may this call run?"
 * decision so the chokepoint in `runGit` is one line.
 */
export function shouldRunGitForCallerScope(callerScope: GitCallScope): boolean {
  return shouldRunGitForScope(resolveGitScope(readGitIntegrationSettings()), callerScope);
}
