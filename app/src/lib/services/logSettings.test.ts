import { describe, expect, it } from "vitest";
import { defaultLogSettings, normalizeLogSettings } from "./logSettings";

describe("logSettings", () => {
  it("defaults verbose provider logging to enabled", () => {
    expect(defaultLogSettings.verboseProviderLogging).toBe(true);
  });

  it("defaults logs panel opening to enabled", () => {
    expect(defaultLogSettings.canOpenLogsPanel).toBe(true);
  });

  it("normalizes partial persisted values", () => {
    expect(normalizeLogSettings({ verboseProviderLogging: false })).toEqual({
      verboseProviderLogging: false,
      canOpenLogsPanel: true,
    });
    expect(normalizeLogSettings({ canOpenLogsPanel: true })).toEqual({
      verboseProviderLogging: true,
      canOpenLogsPanel: true,
    });
  });

  it("falls back to defaults for invalid persisted values", () => {
    expect(normalizeLogSettings(null)).toEqual(defaultLogSettings);
    expect(normalizeLogSettings({ verboseProviderLogging: "yes" })).toEqual(defaultLogSettings);
  });
});
