import { afterEach, describe, expect, it } from "vitest";
import {
  diskChanged,
  fingerprintFromStat,
  fingerprintsEqual,
  isFileMissingError,
  normalizePathSync,
  shouldSkipAsDismissed,
} from "./diskFingerprint";
import { mockNavigatorPlatform } from "../test/helpers";

describe("normalizePathSync", () => {
  let restorePlatform: (() => void) | undefined;

  afterEach(() => {
    restorePlatform?.();
    restorePlatform = undefined;
  });

  it("keeps forward slashes unchanged", () => {
    expect(normalizePathSync("/foo/bar.txt")).toBe("/foo/bar.txt");
  });

  it("converts backslashes to slashes", () => {
    restorePlatform = mockNavigatorPlatform("Linux x86_64");
    expect(normalizePathSync(String.raw`C:\foo\bar.txt`)).toBe("C:/foo/bar.txt");
  });

  it("strips trailing slashes", () => {
    expect(normalizePathSync("/foo/bar/")).toBe("/foo/bar");
  });

  it("preserves root", () => {
    expect(normalizePathSync("/")).toBe("/");
  });

  it("folds case on macOS", () => {
    restorePlatform = mockNavigatorPlatform("MacIntel");
    expect(normalizePathSync("/Foo/Bar.txt")).toBe("/foo/bar.txt");
  });

  it("preserves case on non-macOS", () => {
    restorePlatform = mockNavigatorPlatform("Linux x86_64");
    expect(normalizePathSync("/Foo/Bar.txt")).toBe("/Foo/Bar.txt");
  });
});

describe("fingerprintsEqual", () => {
  const fp = { mtimeMs: 1000, sizeBytes: 42 };

  it("returns true when mtime and size match", () => {
    expect(fingerprintsEqual(fp, { ...fp })).toBe(true);
  });

  it("returns false when mtime differs", () => {
    expect(fingerprintsEqual(fp, { ...fp, mtimeMs: 2000 })).toBe(false);
  });

  it("returns false when size differs", () => {
    expect(fingerprintsEqual(fp, { ...fp, sizeBytes: 99 })).toBe(false);
  });
});

describe("diskChanged", () => {
  const current = { mtimeMs: 2000, sizeBytes: 100 };

  it("treats null known fingerprint as changed", () => {
    expect(diskChanged(null, current)).toBe(true);
  });

  it("detects mtime-only change", () => {
    expect(diskChanged({ mtimeMs: 1000, sizeBytes: 100 }, current)).toBe(true);
  });

  it("detects size-only change", () => {
    expect(diskChanged({ mtimeMs: 2000, sizeBytes: 50 }, current)).toBe(true);
  });

  it("returns false when both fields match", () => {
    expect(diskChanged({ ...current }, current)).toBe(false);
  });
});

describe("shouldSkipAsDismissed", () => {
  const current = { mtimeMs: 2000, sizeBytes: 100 };

  it("returns false when dismissed is null", () => {
    expect(shouldSkipAsDismissed(null, current)).toBe(false);
  });

  it("returns true when dismissed matches current", () => {
    expect(shouldSkipAsDismissed({ ...current }, current)).toBe(true);
  });

  it("returns false when dismissed is stale", () => {
    expect(shouldSkipAsDismissed({ mtimeMs: 1000, sizeBytes: 100 }, current)).toBe(false);
  });
});

describe("fingerprintFromStat", () => {
  it("maps mtime and size", () => {
    const mtime = new Date("2026-01-01T00:00:00.000Z");
    expect(fingerprintFromStat({ size: 512, mtime })).toEqual({
      mtimeMs: mtime.getTime(),
      sizeBytes: 512,
    });
  });

  it("uses zero mtime when stat mtime is null", () => {
    expect(fingerprintFromStat({ size: 10, mtime: null })).toEqual({
      mtimeMs: 0,
      sizeBytes: 10,
    });
  });
});

describe("isFileMissingError", () => {
  it.each([
    "no such file or directory",
    "ENOENT: not found",
    "os error 2",
    "cannot find the path specified",
  ])("detects missing-file message: %s", (message) => {
    expect(isFileMissingError(new Error(message))).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isFileMissingError(new Error("permission denied"))).toBe(false);
  });
});
