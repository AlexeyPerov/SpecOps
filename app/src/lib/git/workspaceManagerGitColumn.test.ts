import { describe, expect, it } from "vitest";
import { formatGitColumnDisplayText } from "./workspaceManagerGitColumn";

describe("formatGitColumnDisplayText", () => {
  it("renders branch, ahead/behind, and dirty marker", () => {
    expect(
      formatGitColumnDisplayText({
        branchName: "main",
        isDetached: false,
        aheadBehind: { ahead: 1, behind: 2 },
        isDirty: true,
        isUnborn: false,
      }),
    ).toBe("main · ↑1 ↓2 · dirty");
  });

  it("renders detached branch label", () => {
    expect(
      formatGitColumnDisplayText({
        branchName: "abc1234",
        isDetached: true,
        aheadBehind: null,
        isDirty: false,
        isUnborn: false,
      }),
    ).toBe("detached @ abc1234 · clean");
  });
});
