import { describe, expect, it } from "vitest";
import { collectImmediateSubfolders } from "./workspaceSubfolders";
import type { CollectImmediateSubfoldersDeps } from "./workspaceSubfolders";

interface FakeEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

function makeDeps(entries: FakeEntry[]): CollectImmediateSubfoldersDeps {
  return {
    readDir: async () => entries as never,
    join: async (...segments: string[]) => segments.join("/"),
    // Identity normalizer keeps the test readable while still exercising the
    // normalization indirection.
    normalizePath: (path: string) => path,
  };
}

describe("collectImmediateSubfolders", () => {
  it("keeps directories and skips files", async () => {
    const entries: FakeEntry[] = [
      { name: "project-a", isDirectory: true, isFile: false, isSymlink: false },
      { name: "readme.md", isDirectory: false, isFile: true, isSymlink: false },
      { name: "project-b", isDirectory: true, isFile: false, isSymlink: false },
    ];
    const result = await collectImmediateSubfolders("/parent", new Set(), makeDeps(entries));
    expect(result.map((entry) => entry.name)).toEqual(["project-a", "project-b"]);
  });

  it("skips symlinks even when they look like directories", async () => {
    const entries: FakeEntry[] = [
      { name: "link", isDirectory: true, isFile: false, isSymlink: true },
      { name: "real", isDirectory: true, isFile: false, isSymlink: false },
    ];
    const result = await collectImmediateSubfolders("/parent", new Set(), makeDeps(entries));
    expect(result.map((entry) => entry.name)).toEqual(["real"]);
  });

  it("flags subfolders whose normalized path is already in the session", async () => {
    const entries: FakeEntry[] = [
      { name: "open", isDirectory: true, isFile: false, isSymlink: false },
      { name: "new", isDirectory: true, isFile: false, isSymlink: false },
    ];
    const result = await collectImmediateSubfolders(
      "/parent",
      new Set(["/parent/open"]),
      makeDeps(entries),
    );
    // Result is sorted alphabetically by name ("new" before "open").
    expect(result).toEqual([
      { path: "/parent/new", name: "new", exists: false },
      { path: "/parent/open", name: "open", exists: true },
    ]);
  });

  it("returns an empty list when readDir throws", async () => {
    const deps: CollectImmediateSubfoldersDeps = {
      readDir: async () => {
        throw new Error("permission denied");
      },
      join: async (...segments: string[]) => segments.join("/"),
      normalizePath: (path: string) => path,
    };
    const result = await collectImmediateSubfolders("/parent", new Set(), deps);
    expect(result).toEqual([]);
  });

  it("sorts entries alphabetically by name", async () => {
    const entries: FakeEntry[] = [
      { name: "zeta", isDirectory: true, isFile: false, isSymlink: false },
      { name: "alpha", isDirectory: true, isFile: false, isSymlink: false },
      { name: "mid", isDirectory: true, isFile: false, isSymlink: false },
    ];
    const result = await collectImmediateSubfolders("/parent", new Set(), makeDeps(entries));
    expect(result.map((entry) => entry.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("normalizes subfolder paths before the exists check", async () => {
    const entries: FakeEntry[] = [
      { name: "Open", isDirectory: true, isFile: false, isSymlink: false },
    ];
    // Existing set holds the *normalized* form ("/parent/open", lowercased);
    // the raw joined path is "/parent/Open" — the helper must normalize before
    // comparing (matching the session dedup key).
    const deps: CollectImmediateSubfoldersDeps = {
      readDir: async () => entries as never,
      join: async (...segments: string[]) => segments.join("/"),
      normalizePath: (path: string) => path.toLowerCase(),
    };
    const result = await collectImmediateSubfolders(
      "/parent",
      new Set(["/parent/open"]),
      deps,
    );
    expect(result).toEqual([{ path: "/parent/Open", name: "Open", exists: true }]);
  });
});
