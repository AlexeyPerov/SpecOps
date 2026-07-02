import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLineCounterCache,
  getLineCounterCache,
  setLineCounterCache,
} from "./lineCounterCache";
import type { LineCountResult } from "./lineCounter";

const sampleResult: LineCountResult = {
  totalLines: 42,
  codeFiles: [{ relPath: "src/main.ts", ext: "ts", lines: 42 }],
  ignoredFiles: [],
  skippedDirs: [],
  readErrors: [],
};

describe("lineCounterCache", () => {
  beforeEach(() => {
    clearLineCounterCache();
  });

  it("stores and retrieves entries by normalized path", () => {
    const scannedAt = new Date("2026-07-02T12:00:00Z");
    setLineCounterCache("/tmp/project/", { result: sampleResult, scannedAt });

    const cached = getLineCounterCache("/tmp/project");
    expect(cached?.result.totalLines).toBe(42);
    expect(cached?.scannedAt).toBe(scannedAt);
  });

  it("treats trailing slashes and backslashes as the same key", () => {
    const scannedAt = new Date("2026-07-02T12:00:00Z");
    setLineCounterCache("/tmp/project", { result: sampleResult, scannedAt });

    expect(getLineCounterCache("/tmp/project/")).toEqual({
      result: sampleResult,
      scannedAt,
    });
    expect(getLineCounterCache(String.raw`\tmp\project`)).toEqual({
      result: sampleResult,
      scannedAt,
    });
  });

  it("overwrites prior entries for the same root", () => {
    setLineCounterCache("/tmp/project", {
      result: sampleResult,
      scannedAt: new Date("2026-07-02T10:00:00Z"),
    });

    const updated: LineCountResult = { ...sampleResult, totalLines: 99 };
    const nextScannedAt = new Date("2026-07-02T13:00:00Z");
    setLineCounterCache("/tmp/project/", { result: updated, scannedAt: nextScannedAt });

    expect(getLineCounterCache("/tmp/project")?.result.totalLines).toBe(99);
    expect(getLineCounterCache("/tmp/project")?.scannedAt).toBe(nextScannedAt);
  });
});
