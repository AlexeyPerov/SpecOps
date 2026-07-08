import type { GitIntegrationSettings } from "../domain/contracts";

export const defaultGitIntegrationSettings: GitIntegrationSettings = {
  enabled: true,
  autosaveBeforeOperations: true,
  showProjectTreeBadges: true,
  showWorkspaceManagerGitColumn: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isGitIntegrationEnabled(
  settings?: GitIntegrationSettings | null,
): boolean {
  return settings?.enabled ?? defaultGitIntegrationSettings.enabled;
}

export function shouldShowProjectTreeGitBadges(
  settings?: GitIntegrationSettings | null,
): boolean {
  return isGitIntegrationEnabled(settings) && (settings?.showProjectTreeBadges ?? true);
}

export function shouldShowWorkspaceManagerGitColumn(
  settings?: GitIntegrationSettings | null,
): boolean {
  return isGitIntegrationEnabled(settings) && (settings?.showWorkspaceManagerGitColumn ?? true);
}

export function shouldAutosaveBeforeGitOperations(
  settings?: GitIntegrationSettings | null,
): boolean {
  return isGitIntegrationEnabled(settings) && (settings?.autosaveBeforeOperations ?? true);
}

export function normalizeGitIntegrationSettings(input?: unknown): GitIntegrationSettings {
  const source = isRecord(input) ? input : {};
  return {
    enabled: isBoolean(source.enabled)
      ? source.enabled
      : defaultGitIntegrationSettings.enabled,
    autosaveBeforeOperations: isBoolean(source.autosaveBeforeOperations)
      ? source.autosaveBeforeOperations
      : defaultGitIntegrationSettings.autosaveBeforeOperations,
    showProjectTreeBadges: isBoolean(source.showProjectTreeBadges)
      ? source.showProjectTreeBadges
      : defaultGitIntegrationSettings.showProjectTreeBadges,
    showWorkspaceManagerGitColumn: isBoolean(source.showWorkspaceManagerGitColumn)
      ? source.showWorkspaceManagerGitColumn
      : defaultGitIntegrationSettings.showWorkspaceManagerGitColumn,
  };
}
