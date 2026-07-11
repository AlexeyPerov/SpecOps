import { describe, expect, it } from "vitest";
import {
  joinDirectoryPath,
  relativePathFromRoot,
  shouldSkipDirectoryEntry,
  shouldSkipFileEntry,
  shouldSkipHeavyDirectoryName,
} from "./workspaceTraversal";

describe("workspaceTraversal policy", () => {
  it("skips hidden/heavy directories and hidden files", () => {
    expect(shouldSkipDirectoryEntry({ name: ".git", isDirectory: true, isFile: false })).toBe(true);
    expect(
      shouldSkipDirectoryEntry({ name: "node_modules", isDirectory: true, isFile: false }),
    ).toBe(true);
    expect(shouldSkipHeavyDirectoryName("dist")).toBe(true);
    expect(shouldSkipFileEntry({ name: ".env", isDirectory: false, isFile: true })).toBe(true);
  });

  it("computes relative paths from a normalized root", () => {
    expect(relativePathFromRoot("/ws/src/a.ts", "/ws")).toBe("src/a.ts");
    expect(relativePathFromRoot("/ws", "/ws")).toBe("");
    expect(joinDirectoryPath("/ws/", "a.ts")).toBe("/ws/a.ts");
  });
});
