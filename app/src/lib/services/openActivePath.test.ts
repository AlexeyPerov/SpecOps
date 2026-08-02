import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import {
  completeLargePendingOpen,
  completeOpenPath,
  requestOpenPath,
} from "./openFileGate";
import { openPath } from "./fileSystem";
import { statDiskFingerprint } from "./diskFingerprint";
import { syncRecentFiles } from "./recentFilesSync";
import { releasePendingOpenFile } from "./openFileRegistry";
import { scheduleTabExternalCheck } from "./externalFileChanges";
import {
  describeOpenActivePathResult,
  isSuccessfulOpenActivePathResult,
  openActivePath,
  openActivePathInPane,
  type OpenActivePathResult,
} from "./openActivePath";

vi.mock("./externalFileChanges", () => ({
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
  scheduleTabExternalCheck: vi.fn(() => "scheduled"),
}));

vi.mock("./openFileGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./openFileGate")>();
  return {
    ...actual,
    requestOpenPath: vi.fn(),
    completeOpenPath: vi.fn(),
    completeLargePendingOpen: vi.fn(),
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

vi.mock("./openFileRegistry", () => ({
  releasePendingOpenFile: vi.fn().mockResolvedValue(undefined),
}));

const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);
const completeLargePendingOpenMock = vi.mocked(completeLargePendingOpen);
const scheduleTabExternalCheckMock = vi.mocked(scheduleTabExternalCheck);
const openPathMock = vi.mocked(openPath);
const statDiskFingerprintMock = vi.mocked(statDiskFingerprint);
const syncRecentFilesMock = vi.mocked(syncRecentFiles);
const releasePendingOpenFileMock = vi.mocked(releasePendingOpenFile);

const WINDOW_ID = "main";
const FILE_PATH = "/tmp/example.txt";

describe("openActivePath", () => {
  beforeEach(() => {
    appState.resetAppState();
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockReset();
    completeLargePendingOpenMock.mockReset();
    scheduleTabExternalCheckMock.mockReset();
    scheduleTabExternalCheckMock.mockReturnValue("scheduled");
    openPathMock.mockReset();
    statDiskFingerprintMock.mockReset();
    syncRecentFilesMock.mockReset();
    releasePendingOpenFileMock.mockClear();
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

  it("returns immediately and checks an existing document in the background", async () => {
    const documentId = appState.openFileInTab(FILE_PATH, "hello", "text");
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: FILE_PATH,
      documentId,
    });
    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "existing", path: FILE_PATH });
    expect(scheduleTabExternalCheckMock).toHaveBeenCalledWith(documentId);
    expect(openPathMock).not.toHaveBeenCalled();
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });

  it("lets the external-change policy skip existing large_pending documents", async () => {
    const documentId = appState.openFileInTab(FILE_PATH, "", "large_pending");
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: FILE_PATH,
      documentId,
    });

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "existing", path: FILE_PATH });
    expect(scheduleTabExternalCheckMock).toHaveBeenCalledWith(documentId);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("moves an existing dirty document to a target pane without replacing content", async () => {
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const sourcePaneId = layout.panes[0]!.id;
    const targetPaneId = layout.panes[1]!.id;
    appState.setActiveEditorPane(sourcePaneId);
    const documentId = appState.openFileInTab(FILE_PATH, "saved", "text");
    appState.setDocumentContent(documentId, "local edits");
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: FILE_PATH,
      documentId,
    });

    const result = await openActivePathInPane(
      FILE_PATH,
      WINDOW_ID,
      targetPaneId,
    );

    expect(result).toEqual({ kind: "existing", path: FILE_PATH });
    const next = appState.getActiveSession().editorLayout;
    expect(next.activePaneId).toBe(targetPaneId);
    expect(
      next.panes.find((pane) => pane.id === targetPaneId)?.tabs.some(
        (tab) => tab.kind === "file" && tab.documentId === documentId,
      ),
    ).toBe(true);
    expect(appState.getActiveDocuments().find((doc) => doc.id === documentId)).toMatchObject({
      content: "local edits",
      savedContent: "saved",
      isDirty: true,
    });
    expect(openPathMock).not.toHaveBeenCalled();
    expect(scheduleTabExternalCheckMock).toHaveBeenCalledWith(documentId);
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
      lineEnding: "crlf",
      hasBom: false,
      fingerprint: { mtimeMs: 2, sizeBytes: 100 },
    });
    completeOpenPathMock.mockResolvedValue("doc-new");

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({ kind: "opened", path: FILE_PATH });
    expect(openPathMock).toHaveBeenCalledWith(FILE_PATH);
    // The detected encoding must reach the document or the first save rewrites the
    // file's line endings.
    expect(completeOpenPathMock).toHaveBeenCalledWith(
      FILE_PATH,
      "hello",
      WINDOW_ID,
      "text",
      {
        lineEnding: "crlf",
        hasBom: false,
      },
      { mtimeMs: 2, sizeBytes: 100 },
    );
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
    expect(releasePendingOpenFileMock).toHaveBeenCalledWith(FILE_PATH, WINDOW_ID);
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
    expect(releasePendingOpenFileMock).toHaveBeenCalledWith(FILE_PATH, WINDOW_ID);
  });

  it("returns failed with unknown error for non-Error throws", async () => {
    requestOpenPathMock.mockRejectedValue("boom");

    const result = await openActivePath(FILE_PATH, WINDOW_ID);

    expect(result).toEqual({
      kind: "failed",
      path: FILE_PATH,
      reason: "unknown error",
    });
    expect(releasePendingOpenFileMock).toHaveBeenCalledWith(FILE_PATH, WINDOW_ID);
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
