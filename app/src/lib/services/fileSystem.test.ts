import { beforeEach, describe, expect, it, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  openFileDialog,
  openPath,
  saveFile,
  saveFileAs,
} from "./fileSystem";
import { statDiskFingerprint } from "./diskFingerprint";
import { recordWriteFingerprint } from "./externalFileChanges";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn(),
  };
});

vi.mock("./externalFileChanges", () => ({
  recordWriteFingerprint: vi.fn(),
}));

const openMock = vi.mocked(open);
const saveMock = vi.mocked(save);
const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);
const statMock = vi.mocked(statDiskFingerprint);
const recordWriteMock = vi.mocked(recordWriteFingerprint);

describe("openPath", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
  });

  it("returns path, content, and UTF-8 byte length", async () => {
    readTextFileMock.mockResolvedValue("hello");
    await expect(openPath("/tmp/open.txt")).resolves.toEqual({
      path: "/tmp/open.txt",
      content: "hello",
      sizeBytes: 5,
    });
  });
});

describe("saveFile", () => {
  beforeEach(() => {
    writeTextFileMock.mockReset();
    statMock.mockReset();
    recordWriteMock.mockReset();
  });

  it("writes content, stats the file, and records the write fingerprint", async () => {
    const fingerprint = { mtimeMs: 100, sizeBytes: 4 };
    statMock.mockResolvedValue(fingerprint);

    await expect(saveFile({ path: "/tmp/save.txt", content: "data" })).resolves.toEqual(
      fingerprint,
    );
    expect(writeTextFileMock).toHaveBeenCalledWith("/tmp/save.txt", "data");
    expect(recordWriteMock).toHaveBeenCalledWith("/tmp/save.txt", fingerprint);
  });
});

describe("saveFileAs", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeTextFileMock.mockReset();
    statMock.mockReset();
    recordWriteMock.mockReset();
  });

  it("returns null when the dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);
    await expect(saveFileAs("content")).resolves.toBeNull();
  });

  it("passes defaultPath to save dialog when provided", async () => {
    saveMock.mockResolvedValue("/tmp/workspace/new.txt");
    statMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 7 });

    await saveFileAs("content", "/tmp/workspace");

    expect(saveMock).toHaveBeenCalledWith({
      title: "Save File As",
      defaultPath: "/tmp/workspace",
    });
  });
});

describe("openFileDialog", () => {
  beforeEach(() => {
    openMock.mockReset();
    readTextFileMock.mockReset();
  });

  it("returns null when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    await expect(openFileDialog()).resolves.toBeNull();
  });
});
