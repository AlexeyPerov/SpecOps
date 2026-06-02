import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDir } from "@tauri-apps/plugin-fs";
import { loadDirectoryChildren } from "./projectTree";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
}));

const readDirMock = vi.mocked(readDir);

describe("loadDirectoryChildren", () => {
  beforeEach(() => {
    readDirMock.mockReset();
  });

  it("returns folders first and alphabetically sorted", async () => {
    readDirMock.mockResolvedValue([
      { name: "z.ts", isDirectory: false, isFile: true, isSymlink: false },
      { name: "src", isDirectory: true, isFile: false, isSymlink: false },
      { name: "a.ts", isDirectory: false, isFile: true, isSymlink: false },
      { name: "docs", isDirectory: true, isFile: false, isSymlink: false },
    ]);

    const nodes = await loadDirectoryChildren("/tmp/ws", "/tmp/ws", { showHidden: false });
    expect(nodes.map((node) => `${node.kind}:${node.name}`)).toEqual([
      "directory:docs",
      "directory:src",
      "file:a.ts",
      "file:z.ts",
    ]);
  });

  it("respects showHidden flag", async () => {
    readDirMock.mockResolvedValue([
      { name: ".env", isDirectory: false, isFile: true, isSymlink: false },
      { name: ".notes.md", isDirectory: false, isFile: true, isSymlink: false },
      { name: "index.ts", isDirectory: false, isFile: true, isSymlink: false },
    ]);

    const hiddenOff = await loadDirectoryChildren("/tmp/ws", "/tmp/ws", { showHidden: false });
    const hiddenOn = await loadDirectoryChildren("/tmp/ws", "/tmp/ws", { showHidden: true });

    expect(hiddenOff.map((node) => node.name)).toEqual(["index.ts"]);
    expect(hiddenOn.map((node) => node.name)).toEqual([".env", ".notes.md", "index.ts"]);
  });

  it("skips symlinks but lists all files including non-openable extensions", async () => {
    readDirMock.mockResolvedValue([
      { name: "linked", isDirectory: false, isFile: true, isSymlink: true },
      { name: "archive.zip", isDirectory: false, isFile: true, isSymlink: false },
      { name: "data.bin", isDirectory: false, isFile: true, isSymlink: false },
      { name: "photo.png", isDirectory: false, isFile: true, isSymlink: false },
      { name: "README.md", isDirectory: false, isFile: true, isSymlink: false },
    ]);

    const nodes = await loadDirectoryChildren("/tmp/ws", "/tmp/ws", { showHidden: false });
    expect(nodes.map((node) => node.name)).toEqual([
      "archive.zip",
      "data.bin",
      "photo.png",
      "README.md",
    ]);
  });

  it("returns empty list for paths outside workspace root", async () => {
    const nodes = await loadDirectoryChildren("/tmp/ws", "/tmp/other", { showHidden: false });
    expect(nodes).toEqual([]);
    expect(readDirMock).not.toHaveBeenCalled();
  });
});
