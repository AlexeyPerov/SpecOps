import { describe, expect, it } from "vitest";
import { deriveUntitledTitle, DEFAULT_UNTITLED_TITLE } from "./untitledTitle";

describe("deriveUntitledTitle", () => {
  it("returns Untitled for empty content", () => {
    expect(deriveUntitledTitle("")).toBe(DEFAULT_UNTITLED_TITLE);
    expect(deriveUntitledTitle("   \n")).toBe(DEFAULT_UNTITLED_TITLE);
  });

  it("uses the trimmed first line", () => {
    expect(deriveUntitledTitle("  My Draft Title\nbody")).toBe("My Draft Title");
    expect(deriveUntitledTitle("# Meeting notes")).toBe("# Meeting notes");
  });

  it("truncates long first lines to 64 characters", () => {
    expect(deriveUntitledTitle("x".repeat(80))).toHaveLength(64);
  });
});
