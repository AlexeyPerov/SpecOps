import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
  exceedsOpenWithoutConfirmLimit,
  normalizeMaxOpenWithoutConfirmBytes,
  shouldGateFileOpenBySize,
} from "./largeFileOpen";

describe("normalizeMaxOpenWithoutConfirmBytes", () => {
  it("returns default for invalid values", () => {
    expect(normalizeMaxOpenWithoutConfirmBytes(undefined)).toBe(
      DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
    );
    expect(normalizeMaxOpenWithoutConfirmBytes("1024")).toBe(
      DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
    );
  });

  it("clamps to supported range", () => {
    expect(normalizeMaxOpenWithoutConfirmBytes(512)).toBe(1024);
    expect(normalizeMaxOpenWithoutConfirmBytes(20 * 1024 * 1024)).toBe(10 * 1024 * 1024);
  });
});

describe("exceedsOpenWithoutConfirmLimit", () => {
  it("is false at or below the limit", () => {
    expect(exceedsOpenWithoutConfirmLimit(1024, 1024)).toBe(false);
    expect(exceedsOpenWithoutConfirmLimit(500, 1024)).toBe(false);
  });

  it("is true above the limit", () => {
    expect(exceedsOpenWithoutConfirmLimit(1025, 1024)).toBe(true);
  });
});

describe("shouldGateFileOpenBySize", () => {
  it("skips image paths", () => {
    expect(shouldGateFileOpenBySize("/tmp/photo.png", 5 * 1024 * 1024, 1024 * 1024)).toBe(false);
  });

  it("gates large non-image files", () => {
    expect(shouldGateFileOpenBySize("/tmp/big.txt", 2 * 1024 * 1024, 1024 * 1024)).toBe(true);
    expect(shouldGateFileOpenBySize("/tmp/small.txt", 512, 1024 * 1024)).toBe(false);
  });
});
