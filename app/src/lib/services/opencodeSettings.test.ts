import { describe, expect, it } from "vitest";
import {
  defaultOpencodeSettings,
  normalizeOpencodeSettings,
  validateOpencodeBaseUrl,
} from "./opencodeSettings";

describe("opencodeSettings", () => {
  it("defaults to sidecar settings", () => {
    expect(normalizeOpencodeSettings(undefined)).toEqual(defaultOpencodeSettings);
  });

  it("normalizes url mode with trimmed base URL", () => {
    expect(
      normalizeOpencodeSettings({
        mode: "url",
        baseUrl: " https://opencode.example.com ",
      }),
    ).toEqual({
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
});
