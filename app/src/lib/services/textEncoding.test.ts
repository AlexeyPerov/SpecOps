import { describe, expect, it } from "vitest";
import {
  decodeTextFile,
  detectLineEnding,
  encodeTextFile,
  normalizeToLf,
} from "./textEncoding";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("decodeTextFile", () => {
  it("normalizes CRLF to LF and reports the line ending", () => {
    const decoded = decodeTextFile(encode("one\r\ntwo\r\nthree"));
    expect(decoded).toEqual({ content: "one\ntwo\nthree", lineEnding: "crlf", hasBom: false });
  });

  it("keeps LF files as LF", () => {
    const decoded = decodeTextFile(encode("one\ntwo"));
    expect(decoded).toEqual({ content: "one\ntwo", lineEnding: "lf", hasBom: false });
  });

  it("strips a UTF-8 BOM and records it", () => {
    const decoded = decodeTextFile(encode("﻿hello"));
    expect(decoded).toEqual({ content: "hello", lineEnding: "lf", hasBom: true });
  });

  it("rejects bytes that are not valid UTF-8 instead of decoding lossily", () => {
    // 0xFF is never valid in UTF-8. A lossy decode would yield U+FFFD, which is what
    // used to get written back over the user's file on save.
    expect(decodeTextFile(new Uint8Array([0x68, 0xff, 0x69]))).toBeNull();
  });

  it("rejects UTF-16 content", () => {
    // "hi" in UTF-16LE: lone 0x00 bytes are not a valid UTF-8 sequence here.
    expect(decodeTextFile(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBeNull();
  });

  it("accepts an empty file", () => {
    expect(decodeTextFile(new Uint8Array())).toEqual({
      content: "",
      lineEnding: "lf",
      hasBom: false,
    });
  });

  it("accepts NUL bytes, which are valid UTF-8", () => {
    const decoded = decodeTextFile(encode("a\0b"));
    expect(decoded?.content).toBe("a\0b");
  });
});

describe("encodeTextFile", () => {
  it("restores CRLF", () => {
    expect(encodeTextFile("one\ntwo", { lineEnding: "crlf", hasBom: false })).toBe("one\r\ntwo");
  });

  it("restores a BOM", () => {
    expect(encodeTextFile("hello", { lineEnding: "lf", hasBom: true })).toBe("﻿hello");
  });

  it("leaves LF content untouched", () => {
    expect(encodeTextFile("one\ntwo", { lineEnding: "lf", hasBom: false })).toBe("one\ntwo");
  });

  it("does not double up CR when the buffer already contains CRLF", () => {
    expect(encodeTextFile("one\r\ntwo", { lineEnding: "crlf", hasBom: false })).toBe("one\r\ntwo");
  });
});

describe("round trip", () => {
  it.each([
    ["CRLF with BOM", "﻿one\r\ntwo\r\n"],
    ["LF plain", "one\ntwo\n"],
    ["CRLF plain", "one\r\ntwo\r\n"],
    ["no trailing newline", "one\r\ntwo"],
    ["empty", ""],
    ["unicode", "héllo\r\n🎉\r\n"],
  ])("preserves %s byte-for-byte", (_label, original) => {
    const decoded = decodeTextFile(encode(original));
    expect(decoded).not.toBeNull();
    const reencoded = encodeTextFile(decoded!.content, {
      lineEnding: decoded!.lineEnding,
      hasBom: decoded!.hasBom,
    });
    expect(reencoded).toBe(original);
  });
});

describe("detectLineEnding", () => {
  it("returns lf when there are no newlines at all", () => {
    expect(detectLineEnding("no newline here")).toBe("lf");
  });

  it("picks the dominant style in a mixed file", () => {
    expect(detectLineEnding("a\r\nb\r\nc\nd")).toBe("crlf");
    expect(detectLineEnding("a\nb\nc\r\nd")).toBe("lf");
  });

  it("treats an equal split as crlf so those lines are preserved", () => {
    expect(detectLineEnding("a\r\nb\n")).toBe("crlf");
  });
});

describe("normalizeToLf", () => {
  it("collapses CRLF and lone CR", () => {
    expect(normalizeToLf("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});
