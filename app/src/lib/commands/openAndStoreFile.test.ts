import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAndStoreFile } from "./openAndStoreFile";
import { completeOpenPath, requestOpenPath } from "../services/openFileGate";

vi.mock("../services/openFileGate", () => ({
  requestOpenPath: vi.fn(),
  completeOpenPath: vi.fn().mockResolvedValue("doc-2"),
}));

const requestOpenPathMock = vi.mocked(requestOpenPath);
const completeOpenPathMock = vi.mocked(completeOpenPath);

describe("openAndStoreFile", () => {
  beforeEach(() => {
    requestOpenPathMock.mockReset();
    completeOpenPathMock.mockClear();
  });

  it("rejects files larger than 10 MB", async () => {
    const notify = vi.fn();
    await openAndStoreFile(notify, "win-a", {
      path: "/tmp/huge.txt",
      content: "x",
      sizeBytes: 10 * 1024 * 1024 + 1,
    });

    expect(notify).toHaveBeenCalledWith("Open failed: file exceeds 10MB MVP limit.");
    expect(requestOpenPathMock).not.toHaveBeenCalled();
  });

  it("opens files within the size limit through the gate", async () => {
    const notify = vi.fn();
    requestOpenPathMock.mockResolvedValue({ kind: "needs_read", path: "/tmp/ok.txt" });

    await openAndStoreFile(notify, "win-a", {
      path: "/tmp/ok.txt",
      content: "payload",
      sizeBytes: 128,
    });

    expect(completeOpenPathMock).toHaveBeenCalledWith("/tmp/ok.txt", "payload", "win-a");
    expect(notify).toHaveBeenCalledWith("Opened /tmp/ok.txt");
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
    });

    expect(notify).toHaveBeenCalledWith("Switched to /tmp/shared.txt in another window.");
    expect(completeOpenPathMock).not.toHaveBeenCalled();
  });
});
