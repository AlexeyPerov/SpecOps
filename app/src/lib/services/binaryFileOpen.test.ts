import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
  normalizeMaxBinaryOpenAsTextBytes,
  resolveBinaryFileOpen,
} from "./binaryFileOpen";

describe("normalizeMaxBinaryOpenAsTextBytes", () => {
  it("returns default for invalid values", () => {
    expect(normalizeMaxBinaryOpenAsTextBytes(undefined)).toBe(
      DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
    );
    expect(normalizeMaxBinaryOpenAsTextBytes("200")).toBe(DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES);
  });

  it("clamps to supported range", () => {
    expect(normalizeMaxBinaryOpenAsTextBytes(512)).toBe(1024);
    expect(normalizeMaxBinaryOpenAsTextBytes(20 * 1024 * 1024)).toBe(10 * 1024 * 1024);
  });
});

describe("resolveBinaryFileOpen", () => {
  it("allows small binary-sniffed files to be tried as text", () => {
    expect(resolveBinaryFileOpen(11, 200 * 1024)).toEqual({ contentKind: "text" });
  });

  it("keeps large binary files as binary preview", () => {
    expect(resolveBinaryFileOpen(300 * 1024, 200 * 1024)).toEqual({ contentKind: "binary" });
  });

  it("treats the threshold as inclusive", () => {
    expect(resolveBinaryFileOpen(200 * 1024, 200 * 1024)).toEqual({ contentKind: "text" });
    expect(resolveBinaryFileOpen(200 * 1024 + 1, 200 * 1024)).toEqual({ contentKind: "binary" });
  });
});
