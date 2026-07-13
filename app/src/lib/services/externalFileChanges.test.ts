import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DiskFingerprint, ExternalFilesSettings } from "../domain/contracts";
import { getSessionTabs } from "../domain/contracts";
import { appState } from "../state/appState";
import { flushMicrotasks } from "../test/sessionMock";
import { statDiskFingerprint } from "./diskFingerprint";
import {
  awaitStartupExternalChecksBackgroundForTests,
  beginSaveInFlight,
  cancelStartupExternalChecks,
  checkDocumentExternalChanges,
  checkDocumentIfDeferred,
  clearSaveInFlight,
  recordWriteFingerprint,
  reloadActiveDocumentFromDisk,
  resetExternalFileChangesForTests,
  runStartupExternalChecks,
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
  maxBinaryOpenAsTextBytes: 200 * 1024,
  maxOpenWithoutConfirmBytes: 1024 * 1024,
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

  it("removes tab when stat fails with fs scope permission error", async () => {
    const path = "/tmp/.gitignore";
    const documentId = prepareSavedFile(path, "ignore", fp1);
    statMock.mockRejectedValue(
      new Error(
        "forbidden path: /tmp/.gitignore, maybe it is not allowed on the scope for `allow-stat` permission",
      ),
    );

    await expect(checkDocumentExternalChanges(documentId, "startup")).resolves.toBe("skipped");
    expect(getSessionTabs(appState.getActiveSession()).some((tab) => tab.kind === "file" && tab.documentId === documentId)).toBe(
      false,
    );
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
    const document = appState.getActiveDocuments().find((doc) => doc.id === documentId);
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

    const document = appState.getActiveDocuments().find((doc) => doc.id === documentId);
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

    const document = appState.getActiveDocuments().find((doc) => doc.id === documentId);
    expect(document?.content).toBe("local edited");
    expect(document?.dismissedFingerprint).toEqual(fp2);
    expect(document?.isDirty).toBe(true);
  });

  it("marks missing files without clearing buffer content", async () => {
    const documentId = prepareSavedFile("/tmp/missing.txt", "keep me", fp1);
    statMock.mockRejectedValue(new Error("no such file or directory"));

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("missing");
    const document = appState.getActiveDocuments().find((doc) => doc.id === documentId);
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
      appState.getActiveDocuments().find((doc) => doc.id === documentId)?.fileMissing,
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

    expect(appState.getActiveDocuments().find((doc) => doc.id === "doc-2")?.content).toBe(
      "updated",
    );
    expect(appState.getActiveDocuments().find((doc) => doc.id === "doc-3")?.content).toBe(
      "other",
    );
  });
});

describe("runStartupExternalChecks", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetAppState();
    setExternalFiles();
    confirmMock.mockReset();
    readTextFileMock.mockReset();
    statMock.mockReset();
  });

  it("checks the active file tab before returning and defers the rest", async () => {
    const firstId = prepareSavedFile("/tmp/startup-a.txt", "a", fp1);
    const secondId = prepareSavedFile("/tmp/startup-b.txt", "b", fp1);
    const thirdId = prepareSavedFile("/tmp/startup-c.txt", "c", fp1);
    const secondTab = getSessionTabs(appState.getActiveSession()).find(
      (tab) => tab.kind === "file" && tab.documentId === secondId,
    );
    if (!secondTab) {
      throw new Error("second tab missing");
    }
    appState.selectTab(secondTab.id);

    let releaseActive!: () => void;
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    let releaseBackground!: () => void;
    const backgroundGate = new Promise<void>((resolve) => {
      releaseBackground = resolve;
    });

    const checkedOrder: string[] = [];
    statMock.mockImplementation(async (path: string) => {
      checkedOrder.push(path);
      if (path.endsWith("startup-b.txt")) {
        await activeGate;
      } else {
        await backgroundGate;
      }
      return fp1;
    });

    const startupPromise = runStartupExternalChecks();
    await flushMicrotasks();
    expect(checkedOrder).toEqual(["/tmp/startup-b.txt"]);

    releaseActive();
    await startupPromise;
    // Background may have started, but must not have finished while gated.
    expect(checkedOrder[0]).toBe("/tmp/startup-b.txt");
    expect(checkedOrder.length).toBeGreaterThanOrEqual(1);
    expect(checkedOrder.length).toBeLessThanOrEqual(3);

    releaseBackground();
    await awaitStartupExternalChecksBackgroundForTests();

    expect(checkedOrder).toEqual([
      "/tmp/startup-b.txt",
      "/tmp/startup-a.txt",
      "/tmp/startup-c.txt",
    ]);
    expect(appState.getActiveDocuments().find((doc) => doc.id === firstId)?.content).toBe("a");
    expect(appState.getActiveDocuments().find((doc) => doc.id === thirdId)?.content).toBe("c");
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("reloads clean non-active tabs in the background without dialogs", async () => {
    const activeId = prepareSavedFile("/tmp/startup-clean-active.txt", "old-active", fp1);
    const backgroundId = prepareSavedFile("/tmp/startup-clean-bg.txt", "old-bg", fp1);
    const activeTab = getSessionTabs(appState.getActiveSession()).find(
      (tab) => tab.kind === "file" && tab.documentId === activeId,
    );
    if (!activeTab) {
      throw new Error("active file tab missing");
    }
    appState.selectTab(activeTab.id);

    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockImplementation(async (path: string) =>
      path.endsWith("startup-clean-bg.txt") ? "new-bg" : "new-active",
    );

    await runStartupExternalChecks();
    expect(appState.getActiveDocuments().find((doc) => doc.id === activeId)?.content).toBe(
      "new-active",
    );
    expect(appState.getActiveDocuments().find((doc) => doc.id === backgroundId)?.content).toBe(
      "old-bg",
    );

    await awaitStartupExternalChecksBackgroundForTests();
    expect(appState.getActiveDocuments().find((doc) => doc.id === backgroundId)?.content).toBe(
      "new-bg",
    );
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("defers dirty startup checks without prompting during priority or background", async () => {
    const dirtyActive = prepareSavedFile("/tmp/startup-dirty-active.txt", "local", fp1, true);
    const dirtyBg = prepareSavedFile("/tmp/startup-dirty-bg.txt", "local", fp1, true);
    const activeTab = getSessionTabs(appState.getActiveSession()).find(
      (tab) => tab.kind === "file" && tab.documentId === dirtyActive,
    );
    if (!activeTab) {
      throw new Error("active dirty tab missing");
    }
    appState.selectTab(activeTab.id);
    statMock.mockResolvedValue(fp2);

    await runStartupExternalChecks();
    await awaitStartupExternalChecksBackgroundForTests();

    expect(confirmMock).not.toHaveBeenCalled();
    expect(
      appState.getActiveDocuments().find((doc) => doc.id === dirtyActive)?.content,
    ).toBe("local edited");
    expect(appState.getActiveDocuments().find((doc) => doc.id === dirtyBg)?.content).toBe(
      "local edited",
    );
  });

  it("continues background drain when an individual check fails", async () => {
    prepareSavedFile("/tmp/startup-fail-a.txt", "a", fp1);
    const okId = prepareSavedFile("/tmp/startup-fail-b.txt", "b", fp1);
    prepareSavedFile("/tmp/startup-fail-c.txt", "c", fp1);
    const firstTab = getSessionTabs(appState.getActiveSession())[0];
    if (!firstTab || firstTab.kind !== "file") {
      throw new Error("expected file tab");
    }
    appState.selectTab(firstTab.id);

    let failCCalls = 0;
    statMock.mockImplementation(async (path: string) => {
      if (path.endsWith("startup-fail-c.txt")) {
        failCCalls += 1;
        throw new Error("simulated stat failure");
      }
      if (path.endsWith("startup-fail-b.txt")) {
        return fp2;
      }
      return fp1;
    });
    readTextFileMock.mockResolvedValue("reloaded-b");

    await runStartupExternalChecks();
    await awaitStartupExternalChecksBackgroundForTests();

    expect(failCCalls).toBeGreaterThan(0);
    expect(appState.getActiveDocuments().find((doc) => doc.id === okId)?.content).toBe(
      "reloaded-b",
    );
  });
});

describe("save/watcher feedback loop", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetAppState();
    setExternalFiles();
    confirmMock.mockReset();
    readTextFileMock.mockReset();
    statMock.mockReset();
  });

  it("suppresses a watcher check while a save for that path is in flight", async () => {
    const documentId = prepareSavedFile("/tmp/inflight-save.txt", "buffer", fp1);
    // Simulate the race window: save has written to disk but the fingerprint
    // has not been recorded yet. The watcher fires for the path in that window.
    beginSaveInFlight("/tmp/inflight-save.txt");
    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("from disk");

    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("unchanged");
    // Buffer was NOT reloaded and no prompt fired.
    const document = appState.getActiveDocuments().find((doc) => doc.id === documentId);
    expect(document?.content).toBe("buffer");
    expect(confirmMock).not.toHaveBeenCalled();

    clearSaveInFlight("/tmp/inflight-save.txt");
  });

  it("detects external changes again once the save is no longer in flight", async () => {
    const documentId = prepareSavedFile("/tmp/after-save.txt", "buffer", fp1);
    beginSaveInFlight("/tmp/after-save.txt");
    statMock.mockResolvedValue(fp2);
    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("unchanged");

    clearSaveInFlight("/tmp/after-save.txt");
    readTextFileMock.mockResolvedValue("from disk");
    await expect(checkDocumentExternalChanges(documentId, "watcher")).resolves.toBe("reloaded");
    expect(appState.getActiveDocuments().find((doc) => doc.id === documentId)?.content).toBe(
      "from disk",
    );
  });
});

describe("cross-context external checks", () => {
  beforeEach(() => {
    resetExternalFileChangesForTests();
    appState.resetAppState();
    setExternalFiles();
    confirmMock.mockReset();
    readTextFileMock.mockReset();
    statMock.mockReset();
  });

  it("runWatcherExternalCheck reloads a file open in an inactive workspace", async () => {
    // File lives in the first workspace; switch active context to the second
    // so the first is inactive.
    const wsAId = appState.addWorkspace("/tmp/ws-a");
    appState.openFileInTab("/tmp/ws-a/file.txt", "old");
    const wsADocId = appState.findDocumentIdByPath("/tmp/ws-a/file.txt")!;
    appState.setDocumentDiskState(wsADocId, {
      diskFingerprint: fp1,
      fileMissing: false,
    });

    appState.addWorkspace("/tmp/ws-b");
    expect(appState.getSnapshot().contexts.activeContextId).not.toBe(wsAId);

    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("updated");

    await runWatcherExternalCheck("/tmp/ws-a/file.txt");

    const wsA = appState.getSnapshot().contexts.workspaces.find((ws) => ws.id === wsAId);
    expect(wsA?.snapshot.documents.find((doc) => doc.id === wsADocId)?.content).toBe("updated");
  });

  it("startup checks cover files open in a non-active workspace", async () => {
    const wsAId = appState.addWorkspace("/tmp/ws-a");
    appState.openFileInTab("/tmp/ws-a/startup-bg.txt", "old");
    const wsADocId = appState.findDocumentIdByPath("/tmp/ws-a/startup-bg.txt")!;
    appState.setDocumentDiskState(wsADocId, { diskFingerprint: fp1, fileMissing: false });

    appState.addWorkspace("/tmp/ws-b");
    appState.openFileInTab("/tmp/ws-b/startup-active.txt", "old-active");
    const activeDocId = appState.findDocumentIdByPath("/tmp/ws-b/startup-active.txt")!;
    appState.setDocumentDiskState(activeDocId, { diskFingerprint: fp1, fileMissing: false });

    statMock.mockResolvedValue(fp2);
    readTextFileMock.mockResolvedValue("fresh");

    await runStartupExternalChecks();
    await awaitStartupExternalChecksBackgroundForTests();

    const wsA = appState.getSnapshot().contexts.workspaces.find((ws) => ws.id === wsAId);
    expect(wsA?.snapshot.documents.find((doc) => doc.id === wsADocId)?.content).toBe("fresh");
  });

  it("cancels background startup checks without throwing", async () => {
    appState.addWorkspace("/tmp/ws-a");
    appState.openFileInTab("/tmp/ws-a/cancel-a.txt", "a", );
    appState.openFileInTab("/tmp/ws-a/cancel-b.txt", "b");
    appState.openFileInTab("/tmp/ws-a/cancel-c.txt", "c");
    const firstTab = appState.getActiveSession().editorLayout.panes[0]?.tabs[0];
    if (firstTab && firstTab.kind === "file") {
      appState.selectTab(firstTab.id);
    }

    let releaseStat!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseStat = resolve;
    });
    statMock.mockImplementation(async () => {
      await gate;
      return fp1;
    });

    const startupPromise = runStartupExternalChecks();
    // Cancel while the background drain is still gated.
    cancelStartupExternalChecks();
    releaseStat();
    await expect(startupPromise).resolves.toBeUndefined();
    await awaitStartupExternalChecksBackgroundForTests();
  });
});
