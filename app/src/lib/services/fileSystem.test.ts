import { beforeEach, describe, expect, it, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile, rename, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  ensureWorkspaceReadAccess,
  openFileDialog,
  openPath,
  probeWorkspaceReadAccess,
  readAllowedWorkspaceRoots,
  saveFile,
  saveFileAs,
} from "./fileSystem";
import { statDiskFingerprint } from "./diskFingerprint";
import { beginSaveInFlight, clearSaveInFlight, recordWriteFingerprint } from "./externalFileChanges";
import { logDiagnostic } from "./logging";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  stat: vi.fn(),
  writeTextFile: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
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
  beginSaveInFlight: vi.fn(),
  clearSaveInFlight: vi.fn(),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/path")>();
  return {
    ...actual,
    join: (...parts: string[]) => parts.join("/"),
  };
});

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

const openMock = vi.mocked(open);
const saveMock = vi.mocked(save);
const readDirMock = vi.mocked(readDir);
const readFileMock = vi.mocked(readFile);
const readTextFileMock = vi.mocked(readTextFile);
const statMockFs = vi.mocked(stat);
const writeTextFileMock = vi.mocked(writeTextFile);
const renameMock = vi.mocked(rename);
const statMock = vi.mocked(statDiskFingerprint);
const recordWriteMock = vi.mocked(recordWriteFingerprint);
const logDiagnosticMock = vi.mocked(logDiagnostic);

/**
 * Saves are atomic (temp file + rename over the target — H24), so writes land
 * on a `<target>.<random>.tmp` sibling. Returns the content written for a
 * target path regardless of which of the two shapes it took.
 */
function writtenContentFor(target: string): string | undefined {
  const call = writeTextFileMock.mock.calls.find(
    (c) => String(c[0]) === target || String(c[0]).startsWith(`${target}.`),
  );
  return call === undefined ? undefined : String(call[1]);
}

describe("openPath", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    statMockFs.mockReset();
    statMockFs.mockResolvedValue({
      size: 5,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
  });

  it("returns path, content, and UTF-8 byte length for text files", async () => {
    readFileMock.mockResolvedValue(new TextEncoder().encode("hello"));
    await expect(openPath("/tmp/open.txt")).resolves.toMatchObject({
      path: "/tmp/open.txt",
      content: "hello",
      sizeBytes: 5,
      contentKind: "text",
      lineEnding: "lf",
      hasBom: false,
      fingerprint: expect.objectContaining({
        mtimeMs: 1,
        sizeBytes: 5,
        contentHash: expect.any(String),
      }),
    });
  });

  it("normalizes CRLF to LF and reports the on-disk line ending", async () => {
    const bytes = new TextEncoder().encode("one\r\ntwo");
    statMockFs.mockResolvedValue({
      size: bytes.length,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
    readFileMock.mockResolvedValue(bytes);
    await expect(openPath("/tmp/crlf.txt")).resolves.toMatchObject({
      path: "/tmp/crlf.txt",
      content: "one\ntwo",
      sizeBytes: bytes.length,
      contentKind: "text",
      lineEnding: "crlf",
      hasBom: false,
      fingerprint: expect.objectContaining({ sizeBytes: bytes.length, contentHash: expect.any(String) }),
    });
  });

  it("opens non-UTF-8 text-sniffed files as binary instead of decoding lossily", async () => {
    // Latin-1 "café": 0xE9 is not a valid UTF-8 sequence. A lossy decode would give a
    // U+FFFD-riddled editable buffer that Cmd+S would write over the original bytes.
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    statMockFs.mockResolvedValue({
      size: bytes.length,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
    readFileMock.mockResolvedValue(bytes);
    await expect(openPath("/tmp/latin1.txt")).resolves.toMatchObject({
      path: "/tmp/latin1.txt",
      content: "",
      sizeBytes: bytes.length,
      contentKind: "binary",
      fingerprint: expect.objectContaining({ sizeBytes: bytes.length, contentHash: expect.any(String) }),
    });
  });

  it("opens images without loading text content", async () => {
    statMockFs.mockResolvedValue({
      size: 1200,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
    readFileMock.mockResolvedValue(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await expect(openPath("/tmp/photo.png")).resolves.toMatchObject({
      path: "/tmp/photo.png",
      content: "",
      sizeBytes: 1200,
      contentKind: "image",
      fingerprint: expect.objectContaining({ sizeBytes: 1200, contentHash: expect.any(String) }),
    });
  });

  it("keeps a small binary file non-editable when it is not valid UTF-8", async () => {
    // Small enough to try as text, but 0xC3 0x28 is an invalid UTF-8 sequence. Opening
    // this as an editable buffer is how Cmd+S used to corrupt small binaries.
    const bytes = new Uint8Array([0x00, 0xc3, 0x28, 0x00]);
    statMockFs.mockResolvedValue({
      size: bytes.length,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
    readFileMock.mockResolvedValue(bytes);
    await expect(
      openPath("/tmp/small.bin", { maxBinaryOpenAsTextBytes: 200 * 1024 }),
    ).resolves.toMatchObject({
      path: "/tmp/small.bin",
      content: "",
      sizeBytes: bytes.length,
      contentKind: "binary",
      fingerprint: expect.objectContaining({ sizeBytes: bytes.length, contentHash: expect.any(String) }),
    });
  });

  it("opens small binary files as text when under the size limit and valid UTF-8", async () => {
    statMockFs.mockResolvedValue({
      size: 32,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
    const bytes = new Uint8Array(32);
    bytes.fill(0x01);
    readFileMock.mockResolvedValue(bytes);
    await expect(
      openPath("/tmp/app.bin", { maxBinaryOpenAsTextBytes: 200 * 1024 }),
    ).resolves.toMatchObject({
      path: "/tmp/app.bin",
      content: "\u0001".repeat(32),
      sizeBytes: 32,
      contentKind: "text",
      lineEnding: "lf",
      hasBom: false,
      fingerprint: expect.objectContaining({ sizeBytes: 32, contentHash: expect.any(String) }),
    });
  });

  it("opens large binary files without decoding as text", async () => {
    statMockFs.mockResolvedValue({
      size: 300 * 1024,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
    const bytes = new Uint8Array(300 * 1024);
    bytes.fill(0x01);
    readFileMock.mockResolvedValue(bytes);
    await expect(
      openPath("/tmp/app.bin", { maxBinaryOpenAsTextBytes: 200 * 1024 }),
    ).resolves.toMatchObject({
      path: "/tmp/app.bin",
      content: "",
      sizeBytes: 300 * 1024,
      contentKind: "binary",
      fingerprint: expect.objectContaining({
        sizeBytes: 300 * 1024,
        contentHash: expect.any(String),
      }),
    });
  });
});

describe("saveFile", () => {
  beforeEach(() => {
    writeTextFileMock.mockReset();
    renameMock.mockReset();
    statMockFs.mockReset();
    recordWriteMock.mockReset();
    statMockFs.mockResolvedValue({
      size: 4,
      mtime: new Date(100),
    } as Awaited<ReturnType<typeof stat>>);
  });

  it("writes content atomically, stats the file, and records the write fingerprint", async () => {
    await expect(saveFile({ path: "/tmp/save.txt", content: "data" })).resolves.toMatchObject({
      mtimeMs: 100,
      sizeBytes: 4,
      contentHash: expect.any(String),
    });
    const [tempPath, written] = writeTextFileMock.mock.calls[0];
    expect(String(tempPath)).toMatch(/^\/tmp\/save\.txt\..+\.tmp$/);
    expect(written).toBe("data");
    expect(renameMock).toHaveBeenCalledWith(tempPath, "/tmp/save.txt");
    expect(recordWriteMock).toHaveBeenCalledWith(
      "/tmp/save.txt",
      expect.objectContaining({ mtimeMs: 100, sizeBytes: 4, contentHash: expect.any(String) }),
    );
  });

  it("restores the document's CRLF line endings and BOM on write", async () => {
    await saveFile({
      path: "/tmp/crlf.txt",
      content: "one\ntwo",
      lineEnding: "crlf",
      hasBom: true,
    });

    expect(writtenContentFor("/tmp/crlf.txt")).toBe("﻿one\r\ntwo");
  });

  it("defaults to LF without a BOM when the caller passes no encoding", async () => {
    await saveFile({ path: "/tmp/plain.txt", content: "one\ntwo" });

    expect(writtenContentFor("/tmp/plain.txt")).toBe("one\ntwo");
  });
});

describe("saveFileAs", () => {
  beforeEach(() => {
    saveMock.mockReset();
    writeTextFileMock.mockReset();
    renameMock.mockReset();
    statMockFs.mockReset();
    recordWriteMock.mockReset();
    statMockFs.mockResolvedValue({
      size: 7,
      mtime: new Date(1),
    } as Awaited<ReturnType<typeof stat>>);
  });

  it("returns null when the dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);
    await expect(saveFileAs("content")).resolves.toBeNull();
  });

  it("passes defaultPath to save dialog when provided", async () => {
    saveMock.mockResolvedValue("/tmp/workspace/new.txt");

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

describe("probeWorkspaceReadAccess", () => {
  beforeEach(() => {
    readDirMock.mockReset();
    writeTextFileMock.mockReset();
  });

  it("returns ready when workspace root is readable", async () => {
    readDirMock.mockResolvedValue([]);
    await expect(probeWorkspaceReadAccess("/tmp/workspace/")).resolves.toBe("ready");
    expect(readDirMock).toHaveBeenCalledWith("/tmp/workspace");
  });

  it("returns blocked without persisting allowed workspace roots", async () => {
    readDirMock.mockRejectedValue(new Error("no such file or directory"));
    await expect(probeWorkspaceReadAccess("/tmp/missing")).resolves.toBe("blocked");
    const accessWrites = writeTextFileMock.mock.calls.filter((call) =>
      String(call[0]).includes("/workspace-access.json"),
    );
    expect(accessWrites).toHaveLength(0);
  });
});

describe("ensureWorkspaceReadAccess", () => {
  beforeEach(() => {
    readDirMock.mockReset();
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    logDiagnosticMock.mockReset();
  });

  it("returns ready and persists normalized workspace root on success", async () => {
    readDirMock.mockResolvedValue([]);
    readTextFileMock.mockImplementation(async (path: string | URL) => {
      const asString = String(path);
      if (asString.endsWith("/workspace-access.json")) {
        throw new Error("missing");
      }
      throw new Error(`unexpected read: ${asString}`);
    });
    writeTextFileMock.mockResolvedValue(undefined);

    await expect(ensureWorkspaceReadAccess("/tmp/workspace/")).resolves.toBe("ready");

    expect(readDirMock).toHaveBeenCalledWith("/tmp/workspace");
    const writeCall = writeTextFileMock.mock.calls.find((call) =>
      String(call[0]).includes("/workspace-access.json"),
    );
    expect(writeCall).toBeDefined();
    const parsed = JSON.parse(String(writeCall?.[1] ?? "{}")) as {
      allowedWorkspaceRoots?: string[];
    };
    expect(parsed.allowedWorkspaceRoots).toEqual(["/tmp/workspace"]);
  });

  it("returns blocked and logs diagnostics when root is inaccessible", async () => {
    readDirMock.mockRejectedValue(new Error("permission denied"));

    await expect(ensureWorkspaceReadAccess("/tmp/denied")).resolves.toBe("blocked");

    expect(logDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "workspace read access preparation failed",
        metadata: expect.objectContaining({
          rootPath: "/tmp/denied",
        }),
      }),
    );
  });
});

describe("readAllowedWorkspaceRoots", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
  });

  it("returns stored allowed roots from workspace access snapshot", async () => {
    readTextFileMock.mockImplementation(async (path: string | URL) => {
      const asString = String(path);
      if (asString.endsWith("/workspace-access.json")) {
        return JSON.stringify({
          version: 1,
          updatedAt: "2026-05-26T00:00:00.000Z",
          allowedWorkspaceRoots: ["/tmp/a", "/tmp/b/"],
        });
      }
      throw new Error(`unexpected read: ${asString}`);
    });

    await expect(readAllowedWorkspaceRoots()).resolves.toEqual(["/tmp/a", "/tmp/b"]);
  });
});
