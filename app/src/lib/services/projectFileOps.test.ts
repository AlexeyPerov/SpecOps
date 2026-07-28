import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import {
  canMoveEntry,
  isBlockedProjectTreeDirectory,
  replaceInProjectFile,
  validateEntryName,
} from "./projectFileOps";
import { createSearchQuery, type SearchQuery } from "../editor/searchQuery";

function litQuery(text: string, replacement: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}): SearchQuery {
  return createSearchQuery({
    text,
    replacement,
    caseSensitive: opts.caseSensitive ?? false,
    wholeWord: opts.wholeWord ?? false,
    regexp: false,
  });
}

function reQuery(text: string, replacement: string, opts: { caseSensitive?: boolean } = {}): SearchQuery {
  return createSearchQuery({
    text,
    replacement,
    caseSensitive: opts.caseSensitive ?? false,
    wholeWord: false,
    regexp: true,
  });
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(),
}));

vi.mock("./atomicWrite", () => ({
  atomicWriteTextFile: vi.fn().mockResolvedValue(undefined),
}));

const readFileMock = vi.mocked(readFile);
const atomicWriteTextFileMock = vi.mocked(atomicWriteTextFile);

describe("validateEntryName", () => {
  it("rejects empty and path separators", () => {
    expect(validateEntryName("")).toBe("Name cannot be empty.");
    expect(validateEntryName("a/b")).toMatch(/separators/);
    expect(validateEntryName("..")).toBe("Invalid name.");
  });

  it("accepts valid names", () => {
    expect(validateEntryName("readme.md")).toBeNull();
  });
});

describe("isBlockedProjectTreeDirectory", () => {
  it("blocks heavy and dot directories", () => {
    expect(isBlockedProjectTreeDirectory("/tmp/ws/node_modules")).toBe(true);
    expect(isBlockedProjectTreeDirectory("/tmp/ws/.git")).toBe(true);
    expect(isBlockedProjectTreeDirectory("/tmp/ws/src")).toBe(false);
  });
});

describe("canMoveEntry", () => {
  const root = "/tmp/ws";

  it("rejects moving folder into itself", () => {
    expect(canMoveEntry(root, "/tmp/ws/src", "/tmp/ws/src/lib")).toMatch(/subfolder/);
  });

  it("rejects same parent", () => {
    expect(canMoveEntry(root, "/tmp/ws/a.txt", "/tmp/ws")).toMatch(/already/);
  });

  it("allows valid move", () => {
    expect(canMoveEntry(root, "/tmp/ws/a.txt", "/tmp/ws/src")).toBeNull();
  });
});

describe("replaceInProjectFile", () => {
  const root = "/tmp/ws";

  beforeEach(() => {
    readFileMock.mockReset();
    atomicWriteTextFileMock.mockReset();
    atomicWriteTextFileMock.mockResolvedValue(undefined);
  });

  it("replaces all matches and writes the rebuilt content", async () => {
    readFileMock.mockResolvedValue(new TextEncoder().encode("foo bar foo"));
    const result = await replaceInProjectFile(root, `${root}/a.txt`, litQuery("foo", "baz"));
    expect(result).toMatchObject({ ok: true, path: `${root}/a.txt`, count: 2, content: "baz bar baz" });
    expect(atomicWriteTextFileMock).toHaveBeenCalledWith(`${root}/a.txt`, "baz bar baz");
  });

  it("respects case sensitivity", async () => {
    readFileMock.mockResolvedValue(new TextEncoder().encode("Foo foo"));
    const result = await replaceInProjectFile(root, `${root}/a.txt`, litQuery("foo", "x", { caseSensitive: true }));
    expect(result).toMatchObject({ ok: true, count: 1, content: "Foo x" });
  });

  it("supports regex capture-group replacement", async () => {
    readFileMock.mockResolvedValue(new TextEncoder().encode("2024-01-15"));
    const result = await replaceInProjectFile(root, `${root}/a.txt`, reQuery("(\\d+)-(\\d+)-(\\d+)", "$3/$2/$1"));
    expect(result).toMatchObject({ ok: true, count: 1, content: "15/01/2024" });
  });

  it("rejects an invalid regex without touching disk", async () => {
    const result = await replaceInProjectFile(root, `${root}/a.txt`, reQuery("(foo", "bar"));
    expect(result).toMatchObject({ ok: false, count: 0 });
    expect(readFileMock).not.toHaveBeenCalled();
    expect(atomicWriteTextFileMock).not.toHaveBeenCalled();
  });

  it("reports no matches without writing", async () => {
    readFileMock.mockResolvedValue(new TextEncoder().encode("nothing here"));
    const result = await replaceInProjectFile(root, `${root}/a.txt`, litQuery("foo", "baz"));
    expect(result).toMatchObject({ ok: false, count: 0 });
    expect(atomicWriteTextFileMock).not.toHaveBeenCalled();
  });

  it("rejects paths outside the workspace", async () => {
    const result = await replaceInProjectFile(root, "/elsewhere/a.txt", litQuery("foo", "baz"));
    expect(result).toMatchObject({ ok: false, count: 0 });
    expect(readFileMock).not.toHaveBeenCalled();
    expect(atomicWriteTextFileMock).not.toHaveBeenCalled();
  });

  it("rejects skipped directories", async () => {
    const result = await replaceInProjectFile(root, `${root}/node_modules/a.js`, litQuery("f", "b"));
    expect(result).toMatchObject({ ok: false, count: 0 });
    expect(readFileMock).not.toHaveBeenCalled();
  });
});
