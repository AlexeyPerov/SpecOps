import { beforeEach, describe, expect, it, vi } from "vitest";
import { dirname } from "@tauri-apps/api/path";
import { readDir, readTextFile, type DirEntry } from "@tauri-apps/plugin-fs";
import {
  listNearbyTextFiles,
  openNearbyPath,
  readNearbyTextFiles,
  type NearbyListEntry,
} from "./nearbyFiles";

vi.mock("@tauri-apps/api/path", () => ({
  dirname: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
}));

const dirnameMock = vi.mocked(dirname);
const readDirMock = vi.mocked(readDir);
const readTextFileMock = vi.mocked(readTextFile);

describe("listNearbyTextFiles", () => {
  it("filters text files, excludes current/open paths, sorts, and limits", () => {
    const entries: NearbyListEntry[] = [
      { name: "zeta.md", isDirectory: false },
      { name: "alpha.txt", isDirectory: false },
      { name: "beta.markdown", isDirectory: false },
      { name: "skip.ts", isDirectory: false },
      { name: "folder", isDirectory: true },
      { name: "same.md", isDirectory: false },
    ];

    const files = listNearbyTextFiles(entries, {
      directoryPath: "/tmp/specs",
      currentFilePath: "/tmp/specs/same.md",
      openPaths: ["/tmp/specs/alpha.txt"],
      limit: 10,
    });

    expect(files.map((entry) => entry.basename)).toEqual(["beta.markdown", "zeta.md"]);
    expect(files.map((entry) => entry.path)).toEqual([
      "/tmp/specs/beta.markdown",
      "/tmp/specs/zeta.md",
    ]);
  });

  it("caps result count at limit", () => {
    const entries: NearbyListEntry[] = Array.from({ length: 20 }, (_, index) => ({
      name: `f-${String(index).padStart(2, "0")}.txt`,
      isDirectory: false,
    }));

    const files = listNearbyTextFiles(entries, {
      directoryPath: "/tmp/specs",
      currentFilePath: "/tmp/specs/current.md",
      openPaths: [],
      limit: 10,
    });

    expect(files).toHaveLength(10);
  });
});

describe("readNearbyTextFiles", () => {
  beforeEach(() => {
    dirnameMock.mockReset();
    readDirMock.mockReset();
  });

  it("returns filtered nearby files from readDir", async () => {
    dirnameMock.mockResolvedValue("/tmp/specs");
    const entries: DirEntry[] = [
      { name: "b.md", isDirectory: false, isFile: true, isSymlink: false },
      { name: "a.txt", isDirectory: false, isFile: true, isSymlink: false },
      { name: "c.ts", isDirectory: false, isFile: true, isSymlink: false },
    ];
    readDirMock.mockResolvedValue(entries);

    await expect(readNearbyTextFiles("/tmp/specs/current.md", ["/tmp/specs/a.txt"])).resolves.toEqual([
      { path: "/tmp/specs/b.md", basename: "b.md" },
    ]);
  });

  it("returns empty list on fs errors", async () => {
    dirnameMock.mockRejectedValue(new Error("boom"));
    await expect(readNearbyTextFiles("/tmp/specs/current.md", [])).resolves.toEqual([]);
  });
});

describe("openNearbyPath", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
  });

  it("reads file content and computes byte size", async () => {
    readTextFileMock.mockResolvedValue("hello");
    await expect(openNearbyPath("/tmp/specs/a.txt")).resolves.toEqual({
      path: "/tmp/specs/a.txt",
      content: "hello",
      sizeBytes: 5,
    });
  });
});
