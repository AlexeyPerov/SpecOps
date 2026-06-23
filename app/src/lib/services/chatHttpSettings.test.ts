import { describe, expect, it } from "vitest";
import {
  defaultChatHttpSettings,
  isChatHttpEnabled,
  normalizeChatHttpSettings,
} from "./chatHttpSettings";

describe("chatHttpSettings", () => {
  it("defaults to enabled=false (opt-in beta)", () => {
    expect(defaultChatHttpSettings).toEqual({ enabled: false });
  });

  it("normalizes undefined input to defaults", () => {
    expect(normalizeChatHttpSettings(undefined)).toEqual({ enabled: false });
  });

  it("normalizes non-object input to defaults", () => {
    expect(normalizeChatHttpSettings("yes")).toEqual({ enabled: false });
    expect(normalizeChatHttpSettings(null)).toEqual({ enabled: false });
    expect(normalizeChatHttpSettings(42)).toEqual({ enabled: false });
  });

  it("preserves enabled=true when present", () => {
    expect(normalizeChatHttpSettings({ enabled: true })).toEqual({ enabled: true });
  });

  it("falls back to enabled=false when value is not a boolean", () => {
    expect(normalizeChatHttpSettings({ enabled: "true" })).toEqual({ enabled: false });
    expect(normalizeChatHttpSettings({ enabled: 1 })).toEqual({ enabled: false });
  });

  it("isChatHttpEnabled returns true only when enabled is true", () => {
    expect(isChatHttpEnabled({ enabled: true })).toBe(true);
    expect(isChatHttpEnabled({ enabled: false })).toBe(false);
    expect(isChatHttpEnabled(undefined)).toBe(false);
    expect(isChatHttpEnabled(null)).toBe(false);
  });
});