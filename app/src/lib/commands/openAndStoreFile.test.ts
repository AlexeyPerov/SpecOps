import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { openAndStoreFile } from "./openAndStoreFile";
import {
  completeLargePendingOpen,
  completeOpenPath,
  requestOpenPath,
} from "../services/openFileGate";
import { initializeDocumentDiskState } from "../services/externalFileChanges";
import type { OpenedFile } from "../services/fileSystem";

vi.mock("../services/externalFileChanges", () => ({
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/openFileGate", () => ({
  requestOpenPath: vi.fn(),
  completeOpenPath: vi.fn().mockResolvedValue("doc-2"),
  completeLargePendingOpen: vi.fn().mockResolvedValue("doc-pending"),
  openedFileEncoding: vi.fn((opened: { lineEnding?: string; hasBom?: boolean }) => ({
    lineEnding: opened.lineEnding,
    hasBom: opened.hasBom,
  })),
}));

const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);
const completeLargePendingOpenMock = vi.mocked(completeLargePendingOpen);
const initializeDocumentDiskStateMock = vi.mocked(initializeDocumentDiskState);

function opened(partial: Partial<OpenedFile> & Pick<OpenedFile, "path" | "content" | "sizeBytes" | "contentKind">): OpenedFile {
  return {
    fingerprint: partial.fingerprint ?? {
      mtimeMs: 1,
      sizeBytes: partial.sizeBytes,
      contentHash: "abc",
    },
    ...partial,
  };
}

describe("openAndStoreFile", () => {
  beforeEach(() => {
    appState.resetAppState();
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockClear();
    completeLargePendingOpenMock.mockClear();
    initializeDocumentDiskStateMock.mockClear();
  });

  it("opens large files as pending confirm tabs", async () => {
    const notify = vi.fn();
    const limit = 1024 * 1024;
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: "/tmp/huge.txt",
      switchedToNotepad: false,
    });
    const fingerprint = { mtimeMs: 1, sizeBytes: limit + 1, contentHash: "huge" };

    await openAndStoreFile(
      notify,
      "win-a",
      opened({
        path: "/tmp/huge.txt",
        content: "x",
        sizeBytes: limit + 1,
        contentKind: "text",
        fingerprint,
      }),
    );

    expect(completeLargePendingOpenMock).toHaveBeenCalledWith("/tmp/huge.txt", fingerprint, "win-a");
    expect(completeOpenPathMock).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Opened /tmp/huge.txt (confirm to load contents)");
  });

  it("opens files within the size limit through the gate", async () => {
    const notify = vi.fn();
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: "/tmp/ok.txt",
      switchedToNotepad: false,
    });
    const fingerprint = { mtimeMs: 1, sizeBytes: 128, contentHash: "ok" };

    await openAndStoreFile(
      notify,
      "win-a",
      opened({
        path: "/tmp/ok.txt",
        content: "payload",
        sizeBytes: 128,
        contentKind: "text",
        lineEnding: "crlf",
        hasBom: true,
        fingerprint,
      }),
    );

    // The detected encoding has to reach the document, or the first save rewrites the
    // file's line endings and drops its BOM.
    expect(completeOpenPathMock).toHaveBeenCalledWith(
      "/tmp/ok.txt",
      "payload",
      "win-a",
      "text",
      {
        lineEnding: "crlf",
        hasBom: true,
      },
      fingerprint,
    );
    expect(notify).toHaveBeenCalledWith("Opened /tmp/ok.txt");
  });

  it("upgrades existing documents from the opened payload", async () => {
    const notify = vi.fn();
    const upgrade = vi.spyOn(appState, "upgradeDocumentFromOpenedFile");
    requestOpenPathMock.mockResolvedValue({
      kind: "existing",
      path: "/tmp/photo.png",
      documentId: "doc-9",
    });
    const fingerprint = { mtimeMs: 1, sizeBytes: 512, contentHash: "img" };

    await openAndStoreFile(
      notify,
      "win-a",
      opened({
        path: "/tmp/photo.png",
        content: "",
        sizeBytes: 512,
        contentKind: "image",
        fingerprint,
      }),
    );

    expect(upgrade).toHaveBeenCalledWith("doc-9", "/tmp/photo.png", "", "image", {
      lineEnding: undefined,
      hasBom: undefined,
    });
    expect(initializeDocumentDiskStateMock).toHaveBeenCalledWith(
      "doc-9",
      "/tmp/photo.png",
      fingerprint,
    );
    expect(completeOpenPathMock).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Opened /tmp/photo.png");
    upgrade.mockRestore();
  });

  it("notifies when redirected to another window", async () => {
    const notify = vi.fn();
    requestOpenPathMock.mockResolvedValue({
      kind: "redirected",
      path: "/tmp/shared.txt",
      ownerWindowId: "win-b",
    });

    await openAndStoreFile(
      notify,
      "win-a",
      opened({
        path: "/tmp/shared.txt",
        content: "payload",
        sizeBytes: 128,
        contentKind: "text",
      }),
    );

    expect(notify).toHaveBeenCalledWith("Switched to /tmp/shared.txt in another window.");
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });
});
