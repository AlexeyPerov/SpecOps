import type { GitIntegrationSettings } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  isGitIntegrationEnabled,
  shouldAutosaveBeforeGitOperations,
  shouldShowProjectTreeGitBadges,
  shouldShowWorkspaceManagerGitColumn,
} from "../services/gitIntegrationSettings";

/** Read the current git-integration settings snapshot from app state. */
export function readGitIntegrationSettings(): GitIntegrationSettings {
  return appState.getSnapshot().settings.gitIntegration;
}

/** Whether git integration is enabled (master toggle). */
export function isGitIntegrationEnabledInApp(): boolean {
  return isGitIntegrationEnabled(readGitIntegrationSettings());
}

/** Whether project-tree git badges should load. */
export function shouldLoadProjectTreeGitBadges(): boolean {
  return shouldShowProjectTreeGitBadges(readGitIntegrationSettings());
}

/** Whether the Workspace Manager git column should load. */
export function shouldLoadWorkspaceManagerGitColumn(): boolean {
  return shouldShowWorkspaceManagerGitColumn(readGitIntegrationSettings());
}

/** Whether autosave should run before git mutations. */
export function shouldRunAutosaveBeforeGitOperations(): boolean {
  return shouldAutosaveBeforeGitOperations(readGitIntegrationSettings());
}
