import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { completeOpenPath, requestOpenPath } from "./openFileGate";
import { openPath } from "./fileSystem";
import { syncRecentFiles } from "./recentFilesSync";
import {
  describeOpenActivePathResult,
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
  };
});

vi.mock("./fileSystem", () => ({
  openPath: vi.fn(),
}));

vi.mock("./recentFilesSync", () => ({
  syncRecentFiles: vi.fn(),
}));

const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);
const openPathMock = vi.mocked(openPath);
const syncRecentFilesMock = vi.mocked(syncRecentFiles);

const WINDOW_ID = "main";
const FILE_PATH = "/tmp/example.txt";

describe("openActivePath", () => {
  beforeEach(() => {
    appState.resetAppState();
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockReset();
    openPathMock.mockReset();
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
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: FILE_PATH,
      documentId: "doc-1",
    });
    openPathMock.mockResolvedValue({
      path: FILE_PATH,
      content: "",
      sizeBytes: 1200,
      contentKind: "image",
    });

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "existing", path: FILE_PATH });
    expect(openPathMock).toHaveBeenCalledWith(FILE_PATH);
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("completes open on happy path", async () => {
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
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

  it("returns too_large without completing open when file exceeds 10MB", async () => {
    const maxBytes = 10 * 1024 * 1024;
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
    openPathMock.mockResolvedValue({
      path: FILE_PATH,
      content: "",
      sizeBytes: maxBytes + 1,
      contentKind: "text",
    });

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "too_large", path: FILE_PATH });
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("prunes missing file from recents and returns missing", async () => {
    appState.replaceRecentFiles(["/tmp/old.txt", FILE_PATH]);
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: FILE_PATH,
      switchedToNotepad: false,
    });
    openPathMock.mockRejectedValue(new Error("no such file or directory"));

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
      result: { kind: "too_large", path: "/big.bin" },
      expected: "Open failed: file exceeds 10MB MVP limit.",
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
