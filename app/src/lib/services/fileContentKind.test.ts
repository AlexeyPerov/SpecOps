import { describe, expect, it } from "vitest";
import {
  inferFileContentKind,
  isBinaryBytes,
  isImageFilePath,
  sniffImageFilePath,
} from "./fileContentKind";

describe("isImageFilePath", () => {
  it("recognizes common image extensions", () => {
    expect(isImageFilePath("/tmp/photo.PNG")).toBe(true);
    expect(isImageFilePath("/tmp/icon.svg")).toBe(true);
  });

  it("rejects non-image paths", () => {
    expect(isImageFilePath("/tmp/readme.md")).toBe(false);
  });
});

describe("isBinaryBytes", () => {
  it("detects NUL bytes", () => {
    expect(isBinaryBytes(new Uint8Array([0x48, 0x00, 0x69]))).toBe(true);
  });

  it("allows plain UTF-8 text", () => {
    const bytes = new TextEncoder().encode("hello\nworld");
    expect(isBinaryBytes(bytes)).toBe(false);
  });
});

describe("sniffImageFilePath", () => {
  it("detects PNG magic bytes", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageFilePath(bytes)).toBe(true);
  });
});

describe("inferFileContentKind", () => {
  it("classifies by extension before sniffing bytes", () => {
    expect(inferFileContentKind("/tmp/a.png", new Uint8Array([0]))).toBe("image");
  });

  it("classifies binary payloads without image signatures", () => {
    const bytes = new Uint8Array(32);
    bytes.fill(0x01);
    expect(inferFileContentKind("/tmp/app.bin", bytes)).toBe("binary");
  });

  it("classifies UTF-8 text", () => {
    const bytes = new TextEncoder().encode("# heading");
    expect(inferFileContentKind("/tmp/readme", bytes)).toBe("text");
  });
});
