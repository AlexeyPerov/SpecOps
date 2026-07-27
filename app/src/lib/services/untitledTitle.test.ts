import { describe, expect, it } from "vitest";
import {
  deriveUntitledFilename,
  deriveUntitledTitle,
  DEFAULT_UNTITLED_TITLE,
} from "./untitledTitle";

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

describe("deriveUntitledFilename", () => {
  it("replaces path separators and illegal characters", () => {
    expect(deriveUntitledFilename("../secret\nbody")).toBe("..-secret");
    expect(deriveUntitledFilename("/etc/passwd")).toBe("etc-passwd");
    expect(deriveUntitledFilename("a:b*c?d")).toBe("a-b-c-d");
  });

  it("strips trailing dots and falls back for empty or reserved names", () => {
    expect(deriveUntitledFilename("notes...")).toBe("notes");
    expect(deriveUntitledFilename("///")).toBe(DEFAULT_UNTITLED_TITLE);
    expect(deriveUntitledFilename("CON")).toBe(DEFAULT_UNTITLED_TITLE);
    expect(deriveUntitledFilename("nul.txt")).toBe(DEFAULT_UNTITLED_TITLE);
  });
});
