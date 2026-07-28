import { describe, expect, it, vi } from "vitest";
import { normalizeGitOutputPath } from "./types";

describe("normalizeGitOutputPath", () => {
  it("converts Windows backslashes to forward slashes on Windows", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "Win32" });
    try {
      expect(normalizeGitOutputPath(String.raw`src\components\App.svelte`)).toBe(
        "src/components/App.svelte",
      );
      expect(normalizeGitOutputPath(String.raw`C:\repo\nested\file.txt`)).toBe(
        "c:/repo/nested/file.txt",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves backslashes intact on POSIX platforms", () => {
    vi.stubGlobal("navigator", { ...navigator, platform: "MacIntel" });
    try {
      expect(normalizeGitOutputPath(String.raw`src\components\App.svelte`)).toBe(
        "src\\components\\App.svelte",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("strips trailing line endings and slashes but keeps meaningful edge spaces", () => {
    // Trailing newline/slash from git output is stripped, but a leading/trailing
    // space that is part of the path is preserved (raw `-z` paths bypass this).
    expect(normalizeGitOutputPath("nested/dir/\n")).toBe("nested/dir");
    expect(normalizeGitOutputPath("nested/dir\r\n")).toBe("nested/dir");
    expect(normalizeGitOutputPath(" lead.txt\n")).toBe(" lead.txt");
    expect(normalizeGitOutputPath("trail.txt \n")).toBe("trail.txt ");
  });

  it("leaves forward-slash paths unchanged", () => {
    expect(normalizeGitOutputPath("nested/folder/file.ts")).toBe("nested/folder/file.ts");
  });
});
