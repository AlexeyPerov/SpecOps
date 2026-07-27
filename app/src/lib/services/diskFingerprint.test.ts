import { afterEach, describe, expect, it } from "vitest";
import {
  diskChanged,
  fingerprintFromStat,
  fingerprintsEqual,
  isFileMissingError,
  needsContentHashVerification,
  normalizePathForStorage,
  normalizePathSync,
  pathsEqual,
  shouldSkipAsDismissed,
} from "./diskFingerprint";
import { mockNavigatorPlatform } from "../test/helpers";

describe("normalizePathForStorage", () => {
  it("preserves case on every platform", () => {
    const restore = mockNavigatorPlatform("MacIntel");
    expect(normalizePathForStorage("/Foo/Bar.txt")).toBe("/Foo/Bar.txt");
    restore();
  });

  it("converts backslashes and strips trailing slashes", () => {
    expect(normalizePathForStorage("C:\\Foo\\Bar\\")).toBe("C:/Foo/Bar");
  });
});

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
    expect(normalizePathSync("C:\\foo\\bar.txt")).toBe("C:/foo/bar.txt");
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

  it("folds case on Windows", () => {
    restorePlatform = mockNavigatorPlatform("Win32");
    expect(normalizePathSync("C:\\Foo\\Bar.txt")).toBe("c:/foo/bar.txt");
  });

  it("preserves case on Linux", () => {
    restorePlatform = mockNavigatorPlatform("Linux x86_64");
    expect(normalizePathSync("/Foo/Bar.txt")).toBe("/Foo/Bar.txt");
  });
});

describe("pathsEqual", () => {
  let restorePlatform: (() => void) | undefined;

  afterEach(() => {
    restorePlatform?.();
    restorePlatform = undefined;
  });

  it("treats case variants as equal on Windows", () => {
    restorePlatform = mockNavigatorPlatform("Win32");
    expect(pathsEqual("C:\\Foo\\a.txt", "C:\\foo\\a.txt")).toBe(true);
  });

  it("treats case variants as distinct on Linux", () => {
    restorePlatform = mockNavigatorPlatform("Linux x86_64");
    expect(pathsEqual("/Foo/a.txt", "/foo/a.txt")).toBe(false);
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

  it("compares content hashes when both sides have them", () => {
    expect(
      fingerprintsEqual(
        { ...fp, contentHash: "aaa" },
        { ...fp, contentHash: "bbb" },
      ),
    ).toBe(false);
    expect(
      fingerprintsEqual(
        { ...fp, contentHash: "aaa" },
        { ...fp, contentHash: "aaa" },
      ),
    ).toBe(true);
  });

  it("ignores a missing hash on one side when metadata matches", () => {
    expect(fingerprintsEqual({ ...fp, contentHash: "aaa" }, fp)).toBe(true);
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

  it("treats size-only fingerprints (mtime 0, no hash) as changed", () => {
    expect(diskChanged({ mtimeMs: 0, sizeBytes: 100 }, { mtimeMs: 0, sizeBytes: 100 })).toBe(
      true,
    );
  });

  it("detects content-hash mismatch when metadata matches", () => {
    expect(
      diskChanged(
        { mtimeMs: 2000, sizeBytes: 100, contentHash: "aaa" },
        { mtimeMs: 2000, sizeBytes: 100, contentHash: "bbb" },
      ),
    ).toBe(true);
  });
});

describe("needsContentHashVerification", () => {
  it("requires verification for watcher events when a hash is known", () => {
    expect(
      needsContentHashVerification({ mtimeMs: 1, sizeBytes: 1, contentHash: "abc" }, "watcher"),
    ).toBe(true);
  });

  it("requires verification when mtime is unavailable", () => {
    expect(
      needsContentHashVerification({ mtimeMs: 0, sizeBytes: 1, contentHash: "abc" }, "focus"),
    ).toBe(true);
  });

  it("skips verification for focus when mtime is reliable", () => {
    expect(
      needsContentHashVerification({ mtimeMs: 1, sizeBytes: 1, contentHash: "abc" }, "focus"),
    ).toBe(false);
  });

  it("skips verification when no hash is known", () => {
    expect(needsContentHashVerification({ mtimeMs: 0, sizeBytes: 1 }, "watcher")).toBe(false);
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
