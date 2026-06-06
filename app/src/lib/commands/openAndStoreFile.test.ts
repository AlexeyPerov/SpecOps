import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { openAndStoreFile } from "./openAndStoreFile";
import {
  completeLargePendingOpen,
  completeOpenPath,
  requestOpenPath,
} from "../services/openFileGate";
import { statDiskFingerprint } from "../services/diskFingerprint";

vi.mock("../services/externalFileChanges", () => ({
  initializeDocumentDiskState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn(),
  };
});

vi.mock("../services/openFileGate", () => ({
  requestOpenPath: vi.fn(),
  completeOpenPath: vi.fn().mockResolvedValue("doc-2"),
  completeLargePendingOpen: vi.fn().mockResolvedValue("doc-pending"),
}));

const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);
const completeLargePendingOpenMock = vi.mocked(completeLargePendingOpen);
const statDiskFingerprintMock = vi.mocked(statDiskFingerprint);

describe("openAndStoreFile", () => {
  beforeEach(() => {
    appState.resetAppState();
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockClear();
    completeLargePendingOpenMock.mockClear();
    statDiskFingerprintMock.mockReset();
  });

  it("opens large files as pending confirm tabs", async () => {
    const notify = vi.fn();
    const limit = 1024 * 1024;
    requestOpenPathMock.mockResolvedValue({
      kind: "needs_read",
      path: "/tmp/huge.txt",
      switchedToNotepad: false,
    });
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: limit + 1 });

    await openAndStoreFile(notify, "win-a", {
      path: "/tmp/huge.txt",
      content: "x",
      sizeBytes: limit + 1,
      contentKind: "text",
    });

    expect(completeLargePendingOpenMock).toHaveBeenCalledWith(
      "/tmp/huge.txt",
      { mtimeMs: 1, sizeBytes: limit + 1 },
      "win-a",
    );
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

    await openAndStoreFile(notify, "win-a", {
      path: "/tmp/ok.txt",
      content: "payload",
      sizeBytes: 128,
      contentKind: "text",
    });

    expect(completeOpenPathMock).toHaveBeenCalledWith("/tmp/ok.txt", "payload", "win-a", "text");
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

    await openAndStoreFile(notify, "win-a", {
      path: "/tmp/photo.png",
      content: "",
      sizeBytes: 512,
      contentKind: "image",
    });

    expect(upgrade).toHaveBeenCalledWith("doc-9", "/tmp/photo.png", "", "image");
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

    await openAndStoreFile(notify, "win-a", {
      path: "/tmp/shared.txt",
      content: "payload",
      sizeBytes: 128,
      contentKind: "text",
    });

    expect(notify).toHaveBeenCalledWith("Switched to /tmp/shared.txt in another window.");
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });
});
