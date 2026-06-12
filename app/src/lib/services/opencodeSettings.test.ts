import { describe, expect, it } from "vitest";
import {
  defaultOpencodeSettings,
  isOpencodeEnabled,
  normalizeOpencodeSettings,
  validateOpencodeBaseUrl,
} from "./opencodeSettings";

describe("opencodeSettings", () => {
  it("defaults to sidecar settings with enabled true", () => {
    expect(normalizeOpencodeSettings(undefined)).toEqual(defaultOpencodeSettings);
    expect(defaultOpencodeSettings.enabled).toBe(true);
  });

  it("normalizes enabled from input", () => {
    expect(normalizeOpencodeSettings({ enabled: false, mode: "sidecar" }).enabled).toBe(false);
    expect(normalizeOpencodeSettings({ mode: "sidecar" }).enabled).toBe(true);
  });

  it("normalizes url mode with trimmed base URL", () => {
    expect(
      normalizeOpencodeSettings({
        enabled: true,
        mode: "url",
        baseUrl: " https://opencode.example.com ",
      }),
    ).toEqual({
      enabled: true,
      mode: "url",
      baseUrl: "https://opencode.example.com",
    });
  });

  it("rejects empty URL in url mode validation", () => {
    expect(validateOpencodeBaseUrl("   ")).toContain("required");
  });

  it("rejects unsupported URL protocol", () => {
    expect(validateOpencodeBaseUrl("ws://localhost:4096")).toContain("http:// or https://");
  });

  it("accepts valid https URL", () => {
    expect(validateOpencodeBaseUrl("https://localhost:4096")).toBeNull();
  });

  describe("isOpencodeEnabled", () => {
    it("returns true for default settings", () => {
      expect(isOpencodeEnabled(defaultOpencodeSettings)).toBe(true);
    });

    it("returns false when enabled is false", () => {
      expect(isOpencodeEnabled({ ...defaultOpencodeSettings, enabled: false })).toBe(false);
    });

    it("returns true for null/undefined input", () => {
      expect(isOpencodeEnabled(null)).toBe(true);
      expect(isOpencodeEnabled(undefined)).toBe(true);
    });
  });
});
