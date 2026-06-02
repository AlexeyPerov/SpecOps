import { describe, expect, it } from "vitest";
import { isOpenableFilePath } from "./editorLanguage";

describe("isOpenableFilePath", () => {
  it("accepts editor extensions and .txt", () => {
    expect(isOpenableFilePath("/tmp/app.ts")).toBe(true);
    expect(isOpenableFilePath("/tmp/readme.txt")).toBe(true);
  });

  it("accepts extensionless text filenames", () => {
    expect(isOpenableFilePath("/tmp/README")).toBe(true);
    expect(isOpenableFilePath("/tmp/Dockerfile")).toBe(true);
    expect(isOpenableFilePath("/tmp/vibe notes")).toBe(true);
    expect(isOpenableFilePath("/tmp/specops")).toBe(true);
  });

  it("rejects unsupported files", () => {
    expect(isOpenableFilePath("/tmp/image.png")).toBe(true);
    expect(isOpenableFilePath("/tmp/data.bin")).toBe(false);
  });
});
