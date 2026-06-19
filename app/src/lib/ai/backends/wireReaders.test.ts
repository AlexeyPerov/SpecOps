import { describe, expect, it } from "vitest";
import {
  readBoolean,
  readNumber,
  readObject,
  readOptionalString,
  readString,
  readStringList,
  readTokenUsage,
} from "./wireReaders";

describe("wireReaders.readObject", () => {
  it("returns the object for a plain object", () => {
    expect(readObject({ a: 1 })).toEqual({ a: 1 });
  });

  it("returns null for null, primitives, and undefined", () => {
    expect(readObject(null)).toBeNull();
    expect(readObject(undefined)).toBeNull();
    expect(readObject("x")).toBeNull();
    expect(readObject(42)).toBeNull();
  });

  // Note: arrays are technically objects in JS, so they pass through unchanged
  // (matches the pre-extraction readers — callers that need a record guard the
  // relevant fields rather than the top-level value).
  it("passes arrays through as objects", () => {
    expect(readObject([1, 2])).toEqual([1, 2]);
  });
});

describe("wireReaders.readString", () => {
  it("returns the string for non-empty content", () => {
    expect(readString("hello")).toBe("hello");
  });

  // Load-bearing contract: callers gate *required* fields on a non-null result,
  // so whitespace-only must read as "missing".
  it("returns null for whitespace-only strings", () => {
    expect(readString("   ")).toBeNull();
    expect(readString("\t\n")).toBeNull();
  });

  it("returns null for empty strings, non-strings, and null/undefined", () => {
    expect(readString("")).toBeNull();
    expect(readString(123)).toBeNull();
    expect(readString(null)).toBeNull();
    expect(readString(undefined)).toBeNull();
  });
});

describe("wireReaders.readOptionalString", () => {
  it("maps whitespace-only to undefined (absent) rather than null", () => {
    expect(readOptionalString("   ")).toBeUndefined();
    expect(readOptionalString("")).toBeUndefined();
  });

  it("returns the string when it carries content", () => {
    expect(readOptionalString("hi")).toBe("hi");
  });
});

describe("wireReaders.readNumber", () => {
  it("returns finite numbers", () => {
    expect(readNumber(0)).toBe(0);
    expect(readNumber(-3.5)).toBe(-3.5);
  });

  it("returns null for NaN and Infinity", () => {
    expect(readNumber(Number.NaN)).toBeNull();
    expect(readNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(readNumber(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("returns null for non-numbers", () => {
    expect(readNumber("3")).toBeNull();
    expect(readNumber(null)).toBeNull();
    expect(readNumber(undefined)).toBeNull();
  });
});

describe("wireReaders.readBoolean", () => {
  it("returns booleans", () => {
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean(false)).toBe(false);
  });

  it("returns null for truthy/falsy non-booleans", () => {
    expect(readBoolean(0)).toBeNull();
    expect(readBoolean("true")).toBeNull();
    expect(readBoolean(null)).toBeNull();
  });
});

describe("wireReaders.readStringList", () => {
  it("collects string entries and drops non-strings", () => {
    expect(readStringList(["a", 1, "b", null, "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns an empty array for an array with no string entries", () => {
    expect(readStringList([1, null, true])).toEqual([]);
  });

  it("returns null when the value is not an array", () => {
    expect(readStringList("a")).toBeNull();
    expect(readStringList(null)).toBeNull();
    expect(readStringList({ a: "b" })).toBeNull();
  });
});

describe("wireReaders.readTokenUsage", () => {
  const valid = {
    input: 10,
    output: 20,
    reasoning: 5,
    cache: { read: 2, write: 3 },
  };

  it("returns a parsed payload for a complete, finite object", () => {
    expect(readTokenUsage(valid)).toEqual(valid);
  });

  it("returns null when any top-level number is missing", () => {
    expect(readTokenUsage({ ...valid, output: undefined })).toBeNull();
    expect(readTokenUsage({ input: 1, output: 2 })).toBeNull();
  });

  it("returns null when cache is missing or incomplete", () => {
    expect(readTokenUsage({ ...valid, cache: undefined })).toBeNull();
    expect(readTokenUsage({ ...valid, cache: { read: 1 } })).toBeNull();
  });

  it("returns null for non-finite numbers, non-objects, and null", () => {
    expect(readTokenUsage({ ...valid, input: Number.NaN })).toBeNull();
    expect(readTokenUsage({ ...valid, cache: { read: 1, write: Number.POSITIVE_INFINITY } })).toBeNull();
    expect(readTokenUsage(null)).toBeNull();
    expect(readTokenUsage("x")).toBeNull();
    expect(readTokenUsage(undefined)).toBeNull();
  });
});
