import { describe, expect, it } from "vitest";
import { bumpRecentFile, formatRecentPath } from "./recentFiles";

describe("bumpRecentFile", () => {
  it("moves an existing path to the front", () => {
    expect(bumpRecentFile(["/tmp/b.txt", "/tmp/a.txt"], "/tmp/a.txt")).toEqual([
      "/tmp/a.txt",
      "/tmp/b.txt",
    ]);
  });

  it("caps the list at 15 entries", () => {
    const files = Array.from({ length: 15 }, (_, index) => `/tmp/file-${index}.txt`);
    const next = bumpRecentFile(files, "/tmp/file-new.txt");
    expect(next).toHaveLength(15);
    expect(next[0]).toBe("/tmp/file-new.txt");
  });
});

describe("formatRecentPath", () => {
  const homeDir = "/Users/username";

  it("shortens paths under home and elides Documents", () => {
    expect(formatRecentPath("/Users/username/Documents/MyProject/notes.txt", homeDir)).toBe(
      "~/MyProject/notes.txt",
    );
  });

  it("shortens Desktop files to the basename under tilde", () => {
    expect(formatRecentPath("/Users/username/Desktop/todo.md", homeDir)).toBe("~/todo.md");
  });

  it("keeps non-system folders under home", () => {
    expect(formatRecentPath("/Users/username/code/spec-ops/README.md", homeDir)).toBe(
      "~/code/spec-ops/README.md",
    );
  });

  it("returns paths outside home unchanged", () => {
    expect(formatRecentPath("/tmp/readme.md", homeDir)).toBe("/tmp/readme.md");
  });

  it("returns the original path when home is unknown", () => {
    expect(formatRecentPath("/Users/username/Documents/readme.md", null)).toBe(
      "/Users/username/Documents/readme.md",
    );
  });
});
