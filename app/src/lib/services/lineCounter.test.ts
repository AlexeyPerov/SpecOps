import { describe, expect, it } from "vitest";
import {
  classifyExtension,
  countNewlines,
  extensionOf,
  isCountedExtension,
} from "./lineCounter";

describe("extensionOf", () => {
  it("returns lowercased extension without the dot", () => {
    expect(extensionOf("src/main.TS")).toBe("ts");
    expect(extensionOf("app.test.JSX")).toBe("jsx");
  });

  it("returns empty string when there is no extension", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("README")).toBe("");
  });

  it("treats a leading dot as a hidden marker, not an extension", () => {
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf(".env")).toBe("");
  });

  it("handles paths with directories and backslashes", () => {
    expect(extensionOf("src\\components\\App.svelte")).toBe("svelte");
    expect(extensionOf("/home/user/app/main.rs")).toBe("rs");
  });

  it("handles double extensions", () => {
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("types.d.ts")).toBe("ts");
  });
});

describe("isCountedExtension", () => {
  it("counts common source extensions", () => {
    expect(isCountedExtension("ts")).toBe(true);
    expect(isCountedExtension("tsx")).toBe(true);
    expect(isCountedExtension("rs")).toBe(true);
    expect(isCountedExtension("py")).toBe(true);
    expect(isCountedExtension("go")).toBe(true);
    expect(isCountedExtension("cs")).toBe(true);
    expect(isCountedExtension("svelte")).toBe(true);
    expect(isCountedExtension("vue")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCountedExtension("TS")).toBe(true);
    expect(isCountedExtension("Rs")).toBe(true);
  });

  it("excludes docs/data formats", () => {
    expect(isCountedExtension("md")).toBe(false);
    expect(isCountedExtension("json")).toBe(false);
    expect(isCountedExtension("yaml")).toBe(false);
    expect(isCountedExtension("toml")).toBe(false);
    expect(isCountedExtension("txt")).toBe(false);
  });

  it("excludes unknown extensions", () => {
    expect(isCountedExtension("lock")).toBe(false);
    expect(isCountedExtension("log")).toBe(false);
    expect(isCountedExtension("bin")).toBe(false);
  });
});

describe("countNewlines", () => {
  it("counts newline bytes", () => {
    const encoder = new TextEncoder();
    expect(countNewlines(encoder.encode("a\nb\nc\n"))).toBe(3);
    expect(countNewlines(encoder.encode("a\nb\nc"))).toBe(2);
    expect(countNewlines(encoder.encode(""))).toBe(0);
  });

  it("counts CRLF as one (only the LF byte)", () => {
    const encoder = new TextEncoder();
    expect(countNewlines(encoder.encode("a\r\nb\r\n"))).toBe(2);
  });

  it("counts empty lines", () => {
    const encoder = new TextEncoder();
    expect(countNewlines(encoder.encode("\n\n\n"))).toBe(3);
  });
});

describe("classifyExtension", () => {
  it("classifies code extensions as counted", () => {
    expect(classifyExtension("ts")).toBe("counted");
    expect(classifyExtension("RS")).toBe("counted");
  });

  it("classifies empty extension as no-extension", () => {
    expect(classifyExtension("")).toBe("no-extension");
  });

  it("classifies non-code extensions as ignored", () => {
    expect(classifyExtension("md")).toBe("ignored");
    expect(classifyExtension("json")).toBe("ignored");
    expect(classifyExtension("lock")).toBe("ignored");
  });
});
