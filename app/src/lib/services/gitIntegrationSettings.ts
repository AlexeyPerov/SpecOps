import type { GitIntegrationScope, GitIntegrationSettings } from "../domain/contracts";

export const defaultGitIntegrationSettings: GitIntegrationSettings = {
  enabled: true,
  scope: "always",
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

const GIT_INTEGRATION_SCOPES: readonly GitIntegrationScope[] = [
  "always",
  "versionControlOnly",
  "off",
];

function normalizeGitIntegrationScope(value: unknown): GitIntegrationScope {
  return GIT_INTEGRATION_SCOPES.includes(value as GitIntegrationScope)
    ? (value as GitIntegrationScope)
    : defaultGitIntegrationSettings.scope;
}

/**
 * P03-08-T1 — effective scope after combining the master `enabled` toggle and
 * {@link GitIntegrationSettings.scope}. Returns `"off"` whenever integration is
 * disabled (either via `enabled: false` or `scope: "off"`), so a single check
 * covers both kill paths.
 */
export function resolveGitScope(
  settings?: GitIntegrationSettings | null,
): GitIntegrationScope {
  if (!isGitIntegrationEnabled(settings)) {
    return "off";
  }
  return settings?.scope ?? defaultGitIntegrationSettings.scope;
}

export function isGitIntegrationEnabled(
  settings?: GitIntegrationSettings | null,
): boolean {
  if (!(settings?.enabled ?? defaultGitIntegrationSettings.enabled)) {
    return false;
  }
  // `scope: "off"` is equivalent to `enabled: false` for every consumer, so the
  // shared predicate treats them alike (closes VC tabs, drains subprocesses,
  // hides menus). This keeps the master toggle and scope independently settable
  // without a third "both off" code path.
  return (settings?.scope ?? defaultGitIntegrationSettings.scope) !== "off";
}

/** True when git may run in the background (badges/column) — only when scope is `"always"`. */
export function isBackgroundGitAllowed(
  settings?: GitIntegrationSettings | null,
): boolean {
  return resolveGitScope(settings) === "always";
}

export function shouldShowProjectTreeGitBadges(
  settings?: GitIntegrationSettings | null,
): boolean {
  // Background UI must never run git under `versionControlOnly`/`off`.
  return isBackgroundGitAllowed(settings) && (settings?.showProjectTreeBadges ?? true);
}

export function shouldShowWorkspaceManagerGitColumn(
  settings?: GitIntegrationSettings | null,
): boolean {
  return (
    isBackgroundGitAllowed(settings) && (settings?.showWorkspaceManagerGitColumn ?? true)
  );
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
    scope: normalizeGitIntegrationScope(source.scope),
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
