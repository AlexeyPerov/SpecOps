import { describe, expect, it } from "vitest";
import { mutationChangesHead } from "./versionControlRefresh";

describe("mutationChangesHead", () => {
  it("returns true for operations that move HEAD", () => {
    expect(mutationChangesHead("commit")).toBe(true);
    expect(mutationChangesHead("checkout")).toBe(true);
    expect(mutationChangesHead("branch")).toBe(true);
    expect(mutationChangesHead("pull")).toBe(true);
  });

  it("returns false for operations that do not move HEAD", () => {
    expect(mutationChangesHead("stage")).toBe(false);
    expect(mutationChangesHead("fetch")).toBe(false);
    expect(mutationChangesHead("push")).toBe(false);
    expect(mutationChangesHead("tag")).toBe(false);
  });
});
