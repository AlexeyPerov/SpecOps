import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";

const renameFileMock = vi.fn();
const renameOpenFileRegistryMock = vi.fn();
const statDiskFingerprintMock = vi.fn();

vi.mock("./fileSystem", () => ({
  renameFile: (...args: unknown[]) => renameFileMock(...args),
}));

vi.mock("./openFileRegistry", () => ({
  renameOpenFileRegistry: (...args: unknown[]) => renameOpenFileRegistryMock(...args),
}));

vi.mock("./diskFingerprint", () => ({
  statDiskFingerprint: (...args: unknown[]) => statDiskFingerprintMock(...args),
}));

import { renameDocumentOnDisk } from "./documentRename";

describe("renameDocumentOnDisk", () => {
  const notify = vi.fn();

  beforeEach(() => {
    appState.resetAppState();
    notify.mockReset();
    renameFileMock.mockReset();
    renameOpenFileRegistryMock.mockReset();
    statDiskFingerprintMock.mockReset();
  });

  it("renames on disk and updates document state", async () => {
    appState.markDocumentSaved("doc-1", "/tmp/foo.txt", "hello");
    renameFileMock.mockResolvedValue("/tmp/bar.txt");
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 5 });

    await renameDocumentOnDisk("doc-1", { windowId: "main", notify });

    expect(renameFileMock).toHaveBeenCalledWith("/tmp/foo.txt");
    const doc = appState.getSnapshot().documents.find((entry) => entry.id === "doc-1");
    expect(doc?.filePath).toBe("/tmp/bar.txt");
    expect(doc?.title).toBe("bar.txt");
    expect(renameOpenFileRegistryMock).toHaveBeenCalledWith(
      "/tmp/foo.txt",
      "/tmp/bar.txt",
      "main",
      "doc-1",
    );
    expect(notify).toHaveBeenCalledWith("Renamed to bar.txt");
  });

  it("leaves state unchanged when the dialog is cancelled", async () => {
    appState.markDocumentSaved("doc-1", "/tmp/foo.txt", "hello");
    renameFileMock.mockResolvedValue(null);

    await renameDocumentOnDisk("doc-1", { windowId: "main", notify });

    const doc = appState.getSnapshot().documents.find((entry) => entry.id === "doc-1");
    expect(doc?.filePath).toBe("/tmp/foo.txt");
    expect(renameOpenFileRegistryMock).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps dirty documents dirty after rename", async () => {
    appState.markDocumentSaved("doc-1", "/tmp/foo.txt", "hello");
    appState.setDocumentContent("doc-1", "changed");
    renameFileMock.mockResolvedValue("/tmp/bar.txt");
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 1, sizeBytes: 7 });

    await renameDocumentOnDisk("doc-1", { windowId: "main", notify });

    const doc = appState.getSnapshot().documents.find((entry) => entry.id === "doc-1");
    expect(doc?.isDirty).toBe(true);
    expect(doc?.content).toBe("changed");
  });

  it("notifies when the document has no file path", async () => {
    await renameDocumentOnDisk("doc-1", { windowId: "main", notify });

    expect(renameFileMock).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Save document before renaming.");
  });
});
