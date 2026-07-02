import { describe, expect, it } from "vitest";
import {
  commitRefBadgeTitle,
  formatRelativeCommitDate,
  formatShortSha,
} from "./gitHistoryFormat";

describe("formatShortSha", () => {
  it("abbreviates long SHAs to seven characters by default", () => {
    expect(formatShortSha("fe3fcdbb69181a9771325f0a0afa029c398d1c71")).toBe("fe3fcdb");
  });

  it("returns short SHAs unchanged", () => {
    expect(formatShortSha("abc1234")).toBe("abc1234");
  });
});

describe("formatRelativeCommitDate", () => {
  const now = new Date("2026-07-02T12:00:00.000Z");

  it("returns an empty string for invalid timestamps", () => {
    expect(formatRelativeCommitDate(0, now)).toBe("");
    expect(formatRelativeCommitDate(Number.NaN, now)).toBe("");
  });

  it("formats recent commits in relative units", () => {
    const twoHoursAgo = Math.floor(now.getTime() / 1000) - 2 * 3600;
    expect(formatRelativeCommitDate(twoHoursAgo, now)).toMatch(/hour/i);
  });

  it("formats older commits in days or longer units", () => {
    const tenDaysAgo = Math.floor(now.getTime() / 1000) - 10 * 86400;
    expect(formatRelativeCommitDate(tenDaysAgo, now)).toMatch(/day/i);
  });
});

describe("commitRefBadgeTitle", () => {
  it("describes branch and tag refs for tooltips", () => {
    expect(commitRefBadgeTitle({ type: "tag", name: "v1.0.0" })).toBe("Tag v1.0.0");
    expect(commitRefBadgeTitle({ type: "currentBranchHead", name: "master" })).toBe(
      "Current branch master",
    );
    expect(commitRefBadgeTitle({ type: "remoteBranchHead", name: "origin/main" })).toBe(
      "Remote branch origin/main",
    );
  });
});
