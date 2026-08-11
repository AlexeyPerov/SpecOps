import { describe, expect, it } from "vitest";
import {
  hasCapability,
  isKnownCapability,
  normalizeCapabilities,
  type AgentCapability,
} from "./capabilities";

describe("capabilities", () => {
  it("normalizes, trims, dedupes, and drops non-strings", () => {
    expect(
      normalizeCapabilities(["  permissions ", "permissions", 7, "", "mcp", "custom-runtime-only"]),
    ).toEqual(["permissions", "mcp", "custom-runtime-only"]);
  });

  it("knows the standardized capabilities and treats unknown as open-extension", () => {
    expect(isKnownCapability("permissions" as AgentCapability)).toBe(true);
    expect(isKnownCapability("rateLimitReporting")).toBe(true);
    expect(isKnownCapability("somethingNew")).toBe(false);
  });

  it("hasCapability checks membership by canonical id", () => {
    const caps = normalizeCapabilities(["fork", "share"]);
    expect(hasCapability(caps, "fork")).toBe(true);
    expect(hasCapability(caps, "rewind")).toBe(false);
  });
});
