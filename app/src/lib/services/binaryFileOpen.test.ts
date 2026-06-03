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
  it("decodes small binary files as text", () => {
    const bytes = new TextEncoder().encode("hello\0world");
    expect(resolveBinaryFileOpen(bytes, bytes.length, 200 * 1024)).toEqual({
      content: "hello\0world",
      contentKind: "text",
    });
  });

  it("keeps large binary files as binary preview", () => {
    const bytes = new Uint8Array(300 * 1024);
    bytes.fill(0x01);
    expect(resolveBinaryFileOpen(bytes, bytes.length, 200 * 1024)).toEqual({
      content: "",
      contentKind: "binary",
    });
  });
});
