import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint, ExternalFilesSettings } from "../domain/contracts";
import { appState } from "../state/appState";
import { flushMicrotasks } from "../test/sessionMock";
import { statDiskFingerprint } from "./diskFingerprint";
import {
  checkDocumentExternalChanges,
  checkDocumentIfDeferred,
  recordWriteFingerprint,
  reloadActiveDocumentFromDisk,
  resetExternalFileChangesForTests,
  runWatcherExternalCheck,
} from "./externalFileChanges";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn(),
  };
});

const confirmMock = vi.mocked(confirm);
const readTextFileMock = vi.mocked(readTextFile);
const statMock = vi.mocked(statDiskFingerprint);

const fp1: DiskFingerprint = { mtimeMs: 1000, sizeBytes: 10 };
const fp2: DiskFingerprint = { mtimeMs: 2000, sizeBytes: 20 };

const defaultExternalFiles: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

function setExternalFiles(overrides: Partial<ExternalFilesSettings> = {}): void {
  appState.setExternalFilesSettings({ ...defaultExternalFiles, ...overrides });
}

function prepareSavedFile(
  path: string,
  content: string,
  fingerprint: DiskFingerprint,
  dirty = false,
): string {
  appState.openFileInTab(path, content);
  const documentId = appState.findDocumentIdByPath(path);
  if (!documentId) {
    throw new Error(`document not found for ${path}`);
  }
  appState.setDocumentDiskState(documentId, {
    diskFingerprint: fingerprint,
    fileMissing: false,
  });
  if (dirty) {
    appState.setDocumentContent(documentId, `${content} edited`);
  }
  return documentId;
}

describe("checkDocumentExternalChanges", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetAppState();
    setExternalFiles();
    confirmMock.mockReset();
    readTextFileMock.mockReset();
    statMock.mockReset();
  });

  it("returns unchanged when disk fingerprint matches", async () => {
    const documentId = prepareSavedFile("/tmp/unchanged.txt", "same", fp1);
    statMock.mockResolvedValue(fp1);

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("unchanged");
  });

  it("silently reloads a clean buffer when disk changed", async () => {
    const documentId = prepareSavedFile("/tmp/reload.txt", "old", fp1);
    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("new");

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("reloaded");
    const document = appState.getSnapshot().documents.find((doc) => doc.id === documentId);
    expect(document?.content).toBe("new");
    expect(document?.isDirty).toBe(false);
  });

  it("ignores watcher events matching the last app write fingerprint", async () => {
    const path = "/tmp/self-save.txt";
    const documentId = prepareSavedFile(path, "saved", fp1);
    recordWriteFingerprint(path, fp2);
    statMock.mockResolvedValue(fp2);

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("unchanged");
  });

  it("skips re-prompt when dismissed fingerprint matches disk", async () => {
    const documentId = prepareSavedFile("/tmp/dismissed.txt", "local", fp1, true);
    appState.applyDocumentKeepLocal(documentId, fp2);
    statMock.mockResolvedValue(fp2);

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("unchanged");
  });

  it("reloads dirty buffers when user chooses Reload", async () => {
    const documentId = prepareSavedFile("/tmp/dirty-reload.txt", "local", fp1, true);
    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("from disk");
    confirmMock.mockResolvedValue(true);

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("deferred");
    await flushMicrotasks();

    const document = appState.getSnapshot().documents.find((doc) => doc.id === documentId);
    expect(document?.content).toBe("from disk");
    expect(document?.isDirty).toBe(false);
    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it("keeps local edits when user chooses Keep Local", async () => {
    const documentId = prepareSavedFile("/tmp/dirty-keep.txt", "local", fp1, true);
    statMock.mockResolvedValue(fp2);
    confirmMock.mockResolvedValue(false);

    await checkDocumentExternalChanges(documentId, "watcher");
    await flushMicrotasks();

    const document = appState.getSnapshot().documents.find((doc) => doc.id === documentId);
    expect(document?.content).toBe("local edited");
    expect(document?.dismissedFingerprint).toEqual(fp2);
    expect(document?.isDirty).toBe(true);
  });

  it("marks missing files without clearing buffer content", async () => {
    const documentId = prepareSavedFile("/tmp/missing.txt", "keep me", fp1);
    statMock.mockRejectedValue(new Error("no such file or directory"));

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("missing");
    const document = appState.getSnapshot().documents.find((doc) => doc.id === documentId);
    expect(document?.fileMissing).toBe(true);
    expect(document?.content).toBe("keep me");
  });

  it("clears fileMissing when the file reappears on disk", async () => {
    const documentId = prepareSavedFile("/tmp/return.txt", "buffer", fp1);
    appState.setDocumentDiskState(documentId, { diskFingerprint: fp1, fileMissing: true });
    statMock.mockResolvedValue(fp1);
    readTextFileMock.mockResolvedValue("buffer");

    await checkDocumentExternalChanges(documentId, "watcher");
    expect(
      appState.getSnapshot().documents.find((doc) => doc.id === documentId)?.fileMissing,
    ).toBe(false);
  });

  it("skips untitled documents", async () => {
    appState.createTab();
    await expect(checkDocumentExternalChanges("doc-2", "watcher")).resolves.toBe("skipped");
  });

  it("skips automatic checks when watchExternalChanges is disabled", async () => {
    const documentId = prepareSavedFile("/tmp/off.txt", "old", fp1);
    setExternalFiles({ watchExternalChanges: false });
    statMock.mockResolvedValue(fp2);

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("skipped");
  });

  it("still reloads on manual check when watching is disabled", async () => {
    const documentId = prepareSavedFile("/tmp/manual.txt", "old", fp1);
    setExternalFiles({ watchExternalChanges: false });
    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("manual reload");

    await expect(checkDocumentExternalChanges(documentId, "manual")).resolves.toBe("reloaded");
  });

  it("skips auto reload for clean files when autoReloadCleanFiles is off", async () => {
    const documentId = prepareSavedFile("/tmp/no-auto.txt", "old", fp1);
    setExternalFiles({ autoReloadCleanFiles: false });
    statMock.mockResolvedValue(fp2);

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("skipped");
  });

  it("defers dirty startup checks without showing a dialog", async () => {
    const documentId = prepareSavedFile("/tmp/startup.txt", "local", fp1, true);
    statMock.mockResolvedValue(fp2);

    await expect(checkDocumentExternalChanges(documentId, "startup")).resolves.toBe("deferred");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("prompts deferred dirty documents on focus", async () => {
    const documentId = prepareSavedFile("/tmp/defer-focus.txt", "local", fp1, true);
    statMock.mockResolvedValue(fp2);
    confirmMock.mockResolvedValue(false);

    await checkDocumentExternalChanges(documentId, "startup");
    await checkDocumentIfDeferred(documentId, "focus");

    expect(confirmMock).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent checks for the same document", async () => {
    const documentId = prepareSavedFile("/tmp/inflight.txt", "old", fp1);
    let statCalls = 0;
    statMock.mockImplementation(async () => {
      statCalls += 1;
      return fp1;
    });

    const first = checkDocumentExternalChanges(documentId, "watcher");
    const second = checkDocumentExternalChanges(documentId, "watcher");
    await expect(Promise.all([first, second])).resolves.toEqual(["unchanged", "unchanged"]);
    expect(statCalls).toBe(1);
  });

  it("skips while a dialog is already open for the document", async () => {
    const documentId = prepareSavedFile("/tmp/dialog.txt", "local", fp1, true);
    statMock.mockResolvedValue(fp2);
    let resolveConfirm: ((value: boolean) => void) | undefined;
    confirmMock.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        }),
    );

    const first = checkDocumentExternalChanges(documentId, "watcher");
    await flushMicrotasks();
    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("skipped");

    resolveConfirm?.(false);
    await first;
    await flushMicrotasks();
  });
});

describe("reloadActiveDocumentFromDisk", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetAppState();
    setExternalFiles();
    confirmMock.mockReset();
    readTextFileMock.mockReset();
    statMock.mockReset();
  });

  it("reloads clean active documents without a dialog", async () => {
    prepareSavedFile("/tmp/active-clean.txt", "old", fp1);
    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("fresh");

    await expect(reloadActiveDocumentFromDisk()).resolves.toBe("reloaded");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("uses the dirty dialog flow for active dirty documents", async () => {
    prepareSavedFile("/tmp/active-dirty.txt", "local", fp1, true);
    statMock.mockResolvedValue(fp2);
    confirmMock.mockResolvedValue(false);

    await expect(reloadActiveDocumentFromDisk()).resolves.toBe("deferred");
    await flushMicrotasks();
    expect(confirmMock).toHaveBeenCalledOnce();
  });
});

describe("runWatcherExternalCheck", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetAppState();
    setExternalFiles();
    statMock.mockReset();
    readTextFileMock.mockReset();
  });

  it("checks only the tab matching the watched path", async () => {
    prepareSavedFile("/tmp/watched.txt", "old", fp1);
    appState.openFileInTab("/tmp/other.txt", "other");
    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("updated");

    await runWatcherExternalCheck("/tmp/watched.txt");

    expect(appState.getSnapshot().documents.find((doc) => doc.id === "doc-2")?.content).toBe(
      "updated",
    );
    expect(appState.getSnapshot().documents.find((doc) => doc.id === "doc-3")?.content).toBe(
      "other",
    );
  });
});
