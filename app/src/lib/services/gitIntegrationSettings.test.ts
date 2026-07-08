import { describe, expect, it } from "vitest";
import {
  defaultGitIntegrationSettings,
  isGitIntegrationEnabled,
  normalizeGitIntegrationSettings,
  shouldAutosaveBeforeGitOperations,
  shouldShowProjectTreeGitBadges,
  shouldShowWorkspaceManagerGitColumn,
} from "./gitIntegrationSettings";

describe("gitIntegrationSettings", () => {
  it("defaults to enabled git integration with satellite toggles on", () => {
    expect(defaultGitIntegrationSettings).toEqual({
      enabled: true,
      autosaveBeforeOperations: true,
      showProjectTreeBadges: true,
      showWorkspaceManagerGitColumn: true,
    });
  });

  it("normalizes undefined input to defaults", () => {
    expect(normalizeGitIntegrationSettings(undefined)).toEqual(defaultGitIntegrationSettings);
  });

  it("preserves explicit boolean overrides", () => {
    expect(
      normalizeGitIntegrationSettings({
        enabled: false,
        autosaveBeforeOperations: false,
        showProjectTreeBadges: false,
        showWorkspaceManagerGitColumn: false,
      }),
    ).toEqual({
      enabled: false,
      autosaveBeforeOperations: false,
      showProjectTreeBadges: false,
      showWorkspaceManagerGitColumn: false,
    });
  });

  it("falls back invalid booleans to defaults", () => {
    expect(
      normalizeGitIntegrationSettings({
        enabled: "true",
        autosaveBeforeOperations: 1,
        showProjectTreeBadges: null,
        showWorkspaceManagerGitColumn: undefined,
      }),
    ).toEqual(defaultGitIntegrationSettings);
  });

  it("gates satellite options behind the master toggle", () => {
    const disabled = {
      enabled: false,
      autosaveBeforeOperations: true,
      showProjectTreeBadges: true,
      showWorkspaceManagerGitColumn: true,
    };
    expect(isGitIntegrationEnabled(disabled)).toBe(false);
    expect(shouldAutosaveBeforeGitOperations(disabled)).toBe(false);
    expect(shouldShowProjectTreeGitBadges(disabled)).toBe(false);
    expect(shouldShowWorkspaceManagerGitColumn(disabled)).toBe(false);
  });
});
