import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDir, readFile, stat } from "@tauri-apps/plugin-fs";
import { joinDirectoryPath } from "./folderOpenableFiles";
import {
  classifyExtension,
  clearLineCounterInflight,
  countLinesInWorkspace,
  countNewlines,
  DEFAULT_MAX_FILE_BYTES,
  extensionOf,
  isCountedExtension,
} from "./lineCounter";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}));

const readDirMock = vi.mocked(readDir);
const readFileMock = vi.mocked(readFile);
const statMock = vi.mocked(stat);

describe("extensionOf", () => {
  it("returns lowercased extension without the dot", () => {
    expect(extensionOf("src/main.TS")).toBe("ts");
    expect(extensionOf("app.test.JSX")).toBe("jsx");
  });

  it("returns empty string when there is no extension", () => {
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf("README")).toBe("");
  });

  it("treats a leading dot as a hidden marker, not an extension", () => {
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf(".env")).toBe("");
  });

  it("handles paths with directories and backslashes", () => {
    expect(extensionOf("src\\components\\App.svelte")).toBe("svelte");
    expect(extensionOf("/home/user/app/main.rs")).toBe("rs");
  });

  it("handles double extensions", () => {
    expect(extensionOf("archive.tar.gz")).toBe("gz");
    expect(extensionOf("types.d.ts")).toBe("ts");
  });
});

describe("isCountedExtension", () => {
  it("counts common source extensions", () => {
    expect(isCountedExtension("ts")).toBe(true);
    expect(isCountedExtension("tsx")).toBe(true);
    expect(isCountedExtension("rs")).toBe(true);
    expect(isCountedExtension("py")).toBe(true);
    expect(isCountedExtension("go")).toBe(true);
    expect(isCountedExtension("cs")).toBe(true);
    expect(isCountedExtension("svelte")).toBe(true);
    expect(isCountedExtension("vue")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCountedExtension("TS")).toBe(true);
    expect(isCountedExtension("Rs")).toBe(true);
  });

  it("excludes docs/data formats", () => {
    expect(isCountedExtension("md")).toBe(false);
    expect(isCountedExtension("json")).toBe(false);
    expect(isCountedExtension("yaml")).toBe(false);
    expect(isCountedExtension("toml")).toBe(false);
    expect(isCountedExtension("txt")).toBe(false);
  });

  it("excludes unknown extensions", () => {
    expect(isCountedExtension("lock")).toBe(false);
    expect(isCountedExtension("log")).toBe(false);
    expect(isCountedExtension("bin")).toBe(false);
  });
});

describe("countNewlines", () => {
  it("counts newline bytes", () => {
    const encoder = new TextEncoder();
    expect(countNewlines(encoder.encode("a\nb\nc\n"))).toBe(3);
    expect(countNewlines(encoder.encode("a\nb\nc"))).toBe(2);
    expect(countNewlines(encoder.encode(""))).toBe(0);
  });

  it("counts CRLF as one (only the LF byte)", () => {
    const encoder = new TextEncoder();
    expect(countNewlines(encoder.encode("a\r\nb\r\n"))).toBe(2);
  });

  it("counts empty lines", () => {
    const encoder = new TextEncoder();
    expect(countNewlines(encoder.encode("\n\n\n"))).toBe(3);
  });
});

describe("classifyExtension", () => {
  it("classifies code extensions as counted", () => {
    expect(classifyExtension("ts")).toBe("counted");
    expect(classifyExtension("RS")).toBe("counted");
  });

  it("classifies empty extension as no-extension", () => {
    expect(classifyExtension("")).toBe("no-extension");
  });

  it("classifies non-code extensions as ignored", () => {
    expect(classifyExtension("md")).toBe("ignored");
    expect(classifyExtension("json")).toBe("ignored");
    expect(classifyExtension("lock")).toBe("ignored");
  });
});

describe("countLinesInWorkspace walker", () => {
  beforeEach(() => {
    readDirMock.mockReset();
    readFileMock.mockReset();
    statMock.mockReset();
    clearLineCounterInflight();
  });

  it("uses synchronous directory path joining for entries", async () => {
    readDirMock.mockResolvedValue([
      { name: "main.ts", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    statMock.mockResolvedValue({
      size: 12,
      mtime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      readonly: false,
      fileAttributes: null,
    } as Awaited<ReturnType<typeof stat>>);
    readFileMock.mockResolvedValue(new TextEncoder().encode("a\nb\n"));

    await countLinesInWorkspace("/tmp/project/");

    const expectedPath = joinDirectoryPath("/tmp/project", "main.ts");
    expect(statMock).toHaveBeenCalledWith(expectedPath);
    expect(readFileMock).toHaveBeenCalledWith(expectedPath);
  });

  it("dedupes concurrent walks for the same root", async () => {
    let resolveReadDir: ((value: Awaited<ReturnType<typeof readDir>>) => void) | undefined;
    readDirMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReadDir = resolve;
        }),
    );

    const first = countLinesInWorkspace("/tmp/project");
    const second = countLinesInWorkspace("/tmp/project");

    expect(readDirMock).toHaveBeenCalledTimes(1);

    resolveReadDir?.([]);
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ totalLines: 0 }),
      expect.objectContaining({ totalLines: 0 }),
    ]);
  });

  it("rejects when aborted before the walk completes", async () => {
    let resolveReadDir: ((value: Awaited<ReturnType<typeof readDir>>) => void) | undefined;
    readDirMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReadDir = resolve;
        }),
    );

    const controller = new AbortController();
    const pending = countLinesInWorkspace("/tmp/project", { signal: controller.signal });
    controller.abort();

    resolveReadDir?.([
      { name: "main.ts", isDirectory: false, isFile: true, isSymlink: false },
    ]);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("records oversized files in readErrors instead of reading them", async () => {
    readDirMock.mockResolvedValue([
      { name: "bundle.js", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    statMock.mockResolvedValue({
      size: DEFAULT_MAX_FILE_BYTES + 1,
      mtime: new Date(),
      atime: new Date(),
      birthtime: new Date(),
      readonly: false,
      fileAttributes: null,
    } as Awaited<ReturnType<typeof stat>>);

    const result = await countLinesInWorkspace("/tmp/project");

    expect(readFileMock).not.toHaveBeenCalled();
    expect(result.readErrors).toEqual([
      `bundle.js: skipped (file exceeds ${DEFAULT_MAX_FILE_BYTES} bytes)`,
    ]);
    expect(result.totalLines).toBe(0);
  });

  it("surfaces readDir failures in readErrors", async () => {
    readDirMock.mockRejectedValue(new Error("permission denied"));

    const result = await countLinesInWorkspace("/tmp/project");

    expect(result.totalLines).toBe(0);
    expect(result.readErrors).toEqual(["/tmp/project: Error: permission denied"]);
  });
});
