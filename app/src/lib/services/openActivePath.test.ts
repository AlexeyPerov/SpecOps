import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import {
  completeLargePendingOpen,
  completeOpenPath,
  refreshExistingDocumentFromDisk,
  requestOpenPath,
} from "./openFileGate";
import { openPath } from "./fileSystem";
import { statDiskFingerprint } from "./diskFingerprint";
import { syncRecentFiles } from "./recentFilesSync";
import {
  describeOpenActivePathResult,
  isSuccessfulOpenActivePathResult,
  openActivePath,
  type OpenActivePathResult,
} from "./openActivePath";

vi.mock("./externalFileChanges", () => ({
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./openFileGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openFileGate")>();
  return {
    ...actual,
    requestOpenPath: vi.fn(),
    completeOpenPath: vi.fn(),
    completeLargePendingOpen: vi.fn(),
    refreshExistingDocumentFromDisk: vi.fn(),
  };
});

vi.mock("./fileSystem", () => ({
  openPath: vi.fn(),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn(),
  };
});

vi.mock("./recentFilesSync", () => ({
  syncRecentFiles: vi.fn(),
}));

const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);
const completeLargePendingOpenMock = vi.mocked(completeLargePendingOpen);
const refreshExistingDocumentFromDiskMock = vi.mocked(refreshExistingDocumentFromDisk);
const openPathMock = vi.mocked(openPath);
const statDiskFingerprintMock = vi.mocked(statDiskFingerprint);
const syncRecentFilesMock = vi.mocked(syncRecentFiles);

const WINDOW_ID = "main";
const FILE_PATH = "/tmp/example.txt";

describe("openActivePath", () => {
  beforeEach(() => {
    appState.resetAppState();
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockReset();
    completeLargePendingOpenMock.mockReset();
    refreshExistingDocumentFromDiskMock.mockReset();
    openPathMock.mockReset();
    statDiskFingerprintMock.mockReset();
    syncRecentFilesMock.mockReset();
  });

  it("returns redirected and touches recent when gate redirects", async () => {
    const touchRecentFile = vi.spyOn(appState, "touchRecentFile");
    requestOpenPathMock.mockResolvedValue({
      kind: "redirected",
      path: FILE_PATH,
      ownerWindowId: "win-b",
    });

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "redirected", path: FILE_PATH });
    expect(touchRecentFile).toHaveBeenCalledWith(FILE_PATH);
    expect(openPathMock).not.toHaveBeenCalled();
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("re-reads disk and upgrades existing documents when gate finds local tab", async () => {
    const documentId = appState.openFileInTab(FILE_PATH, "hello", "text");
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: FILE_PATH,
      documentId,
    });
    refreshExistingDocumentFromDiskMock.mockResolvedValue({
      path: FILE_PATH,
      content: "",
      sizeBytes: 1200,
      contentKind: "image",
    });

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "existing", path: FILE_PATH });
    expect(refreshExistingDocumentFromDiskMock).toHaveBeenCalledWith(documentId, FILE_PATH);
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("skips disk refresh for existing large_pending documents", async () => {
    const documentId = appState.openFileInTab(FILE_PATH, "", "large_pending");
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: FILE_PATH,
      documentId,
    });

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "existing", path: FILE_PATH });
    expect(refreshExistingDocumentFromDiskMock).not.toHaveBeenCalled();
  });

  it("completes open on happy path", async () => {
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 100 });
    openPathMock.mockResolvedValue({
      path: FILE_PATH,
      content: "hello",
      sizeBytes: 100,
      contentKind: "text",
    });
    completeOpenPathMock.mockResolvedValue("doc-new");

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "opened", path: FILE_PATH });
    expect(openPathMock).toHaveBeenCalledWith(FILE_PATH);
    expect(completeOpenPathMock).toHaveBeenCalledWith(FILE_PATH, "hello", WINDOW_ID, "text");
  });

  it("opens pending confirm tab without reading when file exceeds limit", async () => {
    const limit = 1024 * 1024;
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: limit + 1 });
    completeLargePendingOpenMock.mockResolvedValue("doc-pending");

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "pending_confirm", path: FILE_PATH });
    expect(openPathMock).not.toHaveBeenCalled();
    expect(completeLargePendingOpenMock).toHaveBeenCalledWith(
      FILE_PATH,
      { mtimeMs: 1, sizeBytes: limit + 1 },
      WINDOW_ID,
    );
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("prunes missing file from recents and returns missing", async () => {
    appState.replaceRecentFiles(["/tmp/old.txt", FILE_PATH]);
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
    statDiskFingerprintMock.mockRejectedValue(new Error("no such file or directory"));

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "missing", path: FILE_PATH });
    expect(appState.getSnapshot().recentFiles).toEqual(["/tmp/old.txt"]);
    expect(syncRecentFilesMock).toHaveBeenCalledWith(["/tmp/old.txt"]);
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("returns failed with reason on generic errors", async () => {
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 100 });
    openPathMock.mockRejectedValue(new Error("permission denied"));

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({
      kind: "failed",
      path: FILE_PATH,
      reason: "permission denied",
    });
  });

  it("returns failed with unknown error for non-Error throws", async () => {
    requestOpenPathMock.mockRejectedValue("boom");

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({
      kind: "failed",
      path: FILE_PATH,
      reason: "unknown error",
    });
  });
});

describe("describeOpenActivePathResult", () => {
  const cases: Array<{ result: OpenActivePathResult; expected: string }> = [
    { result: { kind: "opened", path: "/a.txt" }, expected: "Opened /a.txt" },
    { result: { kind: "existing", path: "/a.txt" }, expected: "Opened /a.txt" },
    {
      result: { kind: "redirected", path: "/a.txt" },
      expected: "Switched to /a.txt in another window.",
    },
    {
      result: { kind: "pending_confirm", path: "/big.txt" },
      expected: "Opened /big.txt (confirm to load contents)",
    },
    {
      result: { kind: "missing", path: "/gone.txt" },
      expected: "Removed missing file from recents: /gone.txt",
    },
    {
      result: { kind: "failed", path: "/a.txt", reason: "disk full" },
      expected: "Failed to open file: disk full",
    },
  ];

  it.each(cases)("describes $result.kind", ({ result, expected }) => {
    expect(describeOpenActivePathResult(result)).toBe(expected);
  });
});

describe("isSuccessfulOpenActivePathResult", () => {
  it("treats opened/existing/pending_confirm as success", () => {
    expect(isSuccessfulOpenActivePathResult({ kind: "opened", path: "/a" })).toBe(true);
    expect(isSuccessfulOpenActivePathResult({ kind: "existing", path: "/a" })).toBe(true);
    expect(isSuccessfulOpenActivePathResult({ kind: "pending_confirm", path: "/a" })).toBe(true);
  });

  it("treats redirected/missing/failed as non-success for batch counts", () => {
    expect(isSuccessfulOpenActivePathResult({ kind: "redirected", path: "/a" })).toBe(false);
    expect(isSuccessfulOpenActivePathResult({ kind: "missing", path: "/a" })).toBe(false);
    expect(
      isSuccessfulOpenActivePathResult({ kind: "failed", path: "/a", reason: "nope" }),
    ).toBe(false);
  });
});
