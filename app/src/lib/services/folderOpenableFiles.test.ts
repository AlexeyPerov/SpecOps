import { describe, expect, it } from "vitest";
import {
  collectOpenablePathsFromEntries,
  joinDirectoryPath,
  shouldSkipDirectoryEntry,
  shouldSkipFileEntry,
} from "./folderOpenableFiles";

describe("folder entry filters", () => {
  it("skips dot and hidden directories", () => {
    expect(shouldSkipDirectoryEntry({ name: ".git", isDirectory: true, isFile: false })).toBe(true);
    expect(
      shouldSkipDirectoryEntry({ name: "node_modules", isDirectory: true, isFile: false }),
    ).toBe(true);
    expect(
      shouldSkipDirectoryEntry({ name: "src", isDirectory: true, isFile: false, isHidden: true }),
    ).toBe(true);
  });

  it("skips dot and hidden files", () => {
    expect(shouldSkipFileEntry({ name: ".env", isDirectory: false, isFile: true })).toBe(true);
    expect(
      shouldSkipFileEntry({ name: "secret.txt", isDirectory: false, isFile: true, isHidden: true }),
    ).toBe(true);
  });
});

describe("collectOpenablePathsFromEntries", () => {
  it("collects code and extensionless files sorted alphabetically", () => {
    const paths = collectOpenablePathsFromEntries(
      [
        { name: "zeta.ts", isDirectory: false, isFile: true },
        { name: "README", isDirectory: false, isFile: true },
        { name: "vibe notes", isDirectory: false, isFile: true },
        { name: "notes.txt", isDirectory: false, isFile: true },
        { name: "photo.png", isDirectory: false, isFile: true },
        { name: ".hidden.md", isDirectory: false, isFile: true },
      ],
      "/tmp/project",
    );

    expect(paths).toEqual([
      joinDirectoryPath("/tmp/project", "notes.txt"),
      joinDirectoryPath("/tmp/project", "photo.png"),
      joinDirectoryPath("/tmp/project", "README"),
      joinDirectoryPath("/tmp/project", "vibe notes"),
      joinDirectoryPath("/tmp/project", "zeta.ts"),
    ]);
  });
});
