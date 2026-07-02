import { describe, expect, it } from "vitest";
import { normalizeGitOutputPath } from "./types";

describe("normalizeGitOutputPath", () => {
  it("converts Windows backslashes to forward slashes", () => {
    expect(normalizeGitOutputPath(String.raw`src\components\App.svelte`)).toBe(
      "src/components/App.svelte",
    );
    expect(normalizeGitOutputPath(String.raw`C:\repo\nested\file.txt`)).toBe(
      "C:/repo/nested/file.txt",
    );
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeGitOutputPath("  nested/dir/  ")).toBe("nested/dir");
    expect(normalizeGitOutputPath("src\\module\\")).toBe("src/module");
  });

  it("leaves forward-slash paths unchanged", () => {
    expect(normalizeGitOutputPath("nested/folder/file.ts")).toBe("nested/folder/file.ts");
  });
});
