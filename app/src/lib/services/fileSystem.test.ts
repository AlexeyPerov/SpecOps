import { beforeEach, describe, expect, it, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, readTextFile, stat, writeTextFile } from "@tauri-apps/plugin-fs";
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
import { recordWriteFingerprint } from "./externalFileChanges";
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
const statMock = vi.mocked(statDiskFingerprint);
const recordWriteMock = vi.mocked(recordWriteFingerprint);
const logDiagnosticMock = vi.mocked(logDiagnostic);

describe("openPath", () => {
  beforeEach(() => {
    readFileMock.mockReset();
    statMockFs.mockReset();
    statMockFs.mockResolvedValue({ size: 5 } as Awaited<ReturnType<typeof stat>>);
  });

  it("returns path, content, and UTF-8 byte length for text files", async () => {
    readFileMock.mockResolvedValue(new TextEncoder().encode("hello"));
    await expect(openPath("/tmp/open.txt")).resolves.toEqual({
      path: "/tmp/open.txt",
      content: "hello",
      sizeBytes: 5,
      contentKind: "text",
    });
  });

  it("opens images without loading text content", async () => {
    statMockFs.mockResolvedValue({ size: 1200 } as Awaited<ReturnType<typeof stat>>);
    readFileMock.mockResolvedValue(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    await expect(openPath("/tmp/photo.png")).resolves.toEqual({
      path: "/tmp/photo.png",
      content: "",
      sizeBytes: 1200,
      contentKind: "image",
    });
  });

  it("opens small binary files as text when under the size limit", async () => {
    statMockFs.mockResolvedValue({ size: 32 } as Awaited<ReturnType<typeof stat>>);
    const bytes = new Uint8Array(32);
    bytes.fill(0x01);
    readFileMock.mockResolvedValue(bytes);
    await expect(
      openPath("/tmp/app.bin", { maxBinaryOpenAsTextBytes: 200 * 1024 }),
    ).resolves.toEqual({
      path: "/tmp/app.bin",
      content: "\u0001".repeat(32),
      sizeBytes: 32,
      contentKind: "text",
    });
  });

  it("opens large binary files without decoding as text", async () => {
    statMockFs.mockResolvedValue({ size: 300 * 1024 } as Awaited<ReturnType<typeof stat>>);
    const bytes = new Uint8Array(300 * 1024);
    bytes.fill(0x01);
    readFileMock.mockResolvedValue(bytes);
    await expect(
      openPath("/tmp/app.bin", { maxBinaryOpenAsTextBytes: 200 * 1024 }),
    ).resolves.toEqual({
      path: "/tmp/app.bin",
      content: "",
      sizeBytes: 300 * 1024,
      contentKind: "binary",
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
      String(call[0]).endsWith("/workspace-access.json"),
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
      String(call[0]).endsWith("/workspace-access.json"),
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
