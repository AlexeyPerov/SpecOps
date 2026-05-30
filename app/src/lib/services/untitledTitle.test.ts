import { describe, expect, it } from "vitest";
import { deriveUntitledTitle } from "./untitledTitle";

describe("deriveUntitledTitle", () => {
  it("returns Untitled for empty content", () => {
    expect(deriveUntitledTitle("")).toBe("Untitled");
    expect(deriveUntitledTitle("   \n")).toBe("Untitled");
  });

  it("uses the trimmed first line", () => {
    expect(deriveUntitledTitle("  My Draft Title\nbody")).toBe("My Draft Title");
    expect(deriveUntitledTitle("# Meeting notes")).toBe("# Meeting notes");
  });

  it("truncates long first lines to 64 characters", () => {
    expect(deriveUntitledTitle("x".repeat(80))).toHaveLength(64);
  });
});
