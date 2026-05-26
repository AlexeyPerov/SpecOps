import { beforeEach, describe, expect, it, vi } from "vitest";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  ensureWorkspaceReadAccess,
  openFileDialog,
  openPath,
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
const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);
const statMock = vi.mocked(statDiskFingerprint);
const recordWriteMock = vi.mocked(recordWriteFingerprint);
const logDiagnosticMock = vi.mocked(logDiagnostic);

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
