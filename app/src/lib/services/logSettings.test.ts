import { describe, expect, it } from "vitest";
import { defaultLogSettings, normalizeLogSettings } from "./logSettings";

describe("logSettings", () => {
  it("defaults verbose provider logging to disabled", () => {
    expect(defaultLogSettings.verboseProviderLogging).toBe(false);
  });

  it("defaults logs panel opening to enabled", () => {
    expect(defaultLogSettings.canOpenLogsPanel).toBe(true);
  });

  it("defaults perf log collection to disabled", () => {
    expect(defaultLogSettings.collectPerfLogs).toBe(false);
  });

  it("normalizes partial persisted values", () => {
    expect(normalizeLogSettings({ verboseProviderLogging: false })).toEqual({
      verboseProviderLogging: false,
      canOpenLogsPanel: true,
      collectPerfLogs: false,
    });
    expect(normalizeLogSettings({ canOpenLogsPanel: true, collectPerfLogs: true })).toEqual({
      verboseProviderLogging: false,
      canOpenLogsPanel: true,
      collectPerfLogs: true,
    });
  });

  it("falls back to defaults for invalid persisted values", () => {
    expect(normalizeLogSettings(null)).toEqual(defaultLogSettings);
    expect(normalizeLogSettings({ verboseProviderLogging: "yes" })).toEqual(defaultLogSettings);
  });
});
