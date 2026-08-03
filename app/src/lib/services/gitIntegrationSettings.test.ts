import { describe, expect, it } from "vitest";
import {
  defaultGitIntegrationSettings,
  isBackgroundGitAllowed,
  isGitIntegrationEnabled,
  normalizeGitIntegrationSettings,
  resolveGitScope,
  shouldAutosaveBeforeGitOperations,
  shouldShowProjectTreeGitBadges,
  shouldShowWorkspaceManagerGitColumn,
} from "./gitIntegrationSettings";

describe("gitIntegrationSettings", () => {
  it("defaults to enabled git integration with satellite toggles on and scope always", () => {
    expect(defaultGitIntegrationSettings).toEqual({
      enabled: true,
      scope: "always",
      autosaveBeforeOperations: true,
      showProjectTreeBadges: true,
      showWorkspaceManagerGitColumn: true,
    });
  });

  it("normalizes undefined input to defaults", () => {
    expect(normalizeGitIntegrationSettings(undefined)).toEqual(defaultGitIntegrationSettings);
  });

  it("preserves explicit boolean overrides and scope", () => {
    expect(
      normalizeGitIntegrationSettings({
        enabled: false,
        scope: "versionControlOnly",
        autosaveBeforeOperations: false,
        showProjectTreeBadges: false,
        showWorkspaceManagerGitColumn: false,
      }),
    ).toEqual({
      enabled: false,
      scope: "versionControlOnly",
      autosaveBeforeOperations: false,
      showProjectTreeBadges: false,
      showWorkspaceManagerGitColumn: false,
    });
  });

  it("falls back invalid booleans and scope to defaults", () => {
    expect(
      normalizeGitIntegrationSettings({
        enabled: "true",
        scope: "bogus",
        autosaveBeforeOperations: 1,
        showProjectTreeBadges: null,
        showWorkspaceManagerGitColumn: undefined,
      }),
    ).toEqual(defaultGitIntegrationSettings);
  });

  it("gates satellite options behind the master toggle", () => {
    const disabled = {
      enabled: false,
      scope: "always" as const,
      autosaveBeforeOperations: true,
      showProjectTreeBadges: true,
      showWorkspaceManagerGitColumn: true,
    };
    expect(isGitIntegrationEnabled(disabled)).toBe(false);
    expect(shouldAutosaveBeforeGitOperations(disabled)).toBe(false);
    expect(shouldShowProjectTreeGitBadges(disabled)).toBe(false);
    expect(shouldShowWorkspaceManagerGitColumn(disabled)).toBe(false);
  });

  describe("P03-08-T1 — scope", () => {
    it("scope 'off' behaves like enabled:false for every predicate", () => {
      const off = {
        enabled: true,
        scope: "off" as const,
        autosaveBeforeOperations: true,
        showProjectTreeBadges: true,
        showWorkspaceManagerGitColumn: true,
      };
      expect(isGitIntegrationEnabled(off)).toBe(false);
      expect(resolveGitScope(off)).toBe("off");
      expect(isBackgroundGitAllowed(off)).toBe(false);
      expect(shouldShowProjectTreeGitBadges(off)).toBe(false);
      expect(shouldShowWorkspaceManagerGitColumn(off)).toBe(false);
    });

    it("resolveGitScope reflects enabled and scope together", () => {
      expect(resolveGitScope({ ...defaultGitIntegrationSettings, scope: "always" })).toBe("always");
      expect(
        resolveGitScope({ ...defaultGitIntegrationSettings, scope: "versionControlOnly" }),
      ).toBe("versionControlOnly");
      expect(resolveGitScope({ ...defaultGitIntegrationSettings, enabled: false })).toBe("off");
    });

    it("background git is allowed only under scope 'always'", () => {
      expect(isBackgroundGitAllowed({ ...defaultGitIntegrationSettings, scope: "always" })).toBe(
        true,
      );
      expect(
        isBackgroundGitAllowed({ ...defaultGitIntegrationSettings, scope: "versionControlOnly" }),
      ).toBe(false);
      expect(isBackgroundGitAllowed({ ...defaultGitIntegrationSettings, scope: "off" })).toBe(
        false,
      );
    });

    it("normalizes unknown scope values to the default", () => {
      expect(normalizeGitIntegrationSettings({ scope: "everywhere" }).scope).toBe("always");
      expect(normalizeGitIntegrationSettings({}).scope).toBe("always");
    });
  });
});
