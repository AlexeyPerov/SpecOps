import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionTabs, isFileTab, type ExternalFilesSettings } from "../domain/contracts";
import { appState } from "../state/appState";
import { createAppShellFileHandlers } from "./appShellPageHandlers";
import { checkDocumentIfDeferred } from "./externalFileChanges";

vi.mock("./externalFileChanges", () => ({
  checkDocumentIfDeferred: vi.fn(async () => "unchanged"),
}));

const checkDocumentIfDeferredMock = vi.mocked(checkDocumentIfDeferred);

const defaultExternalFiles: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
  maxBinaryOpenAsTextBytes: 200 * 1024,
  maxOpenWithoutConfirmBytes: 1024 * 1024,
};

function activeFileTabIdByPath(path: string): string {
  const tab = getSessionTabs(appState.getActiveSession()).find(
    (entry) =>
      isFileTab(entry) &&
      appState.getActiveDocuments().find((documentState) => documentState.id === entry.documentId)
        ?.filePath === path,
  );
  if (!tab || !isFileTab(tab)) {
    throw new Error(`file tab not found for path: ${path}`);
  }
  return tab.id;
}

describe("createAppShellFileHandlers.onTabActivated", () => {
  beforeEach(() => {
    appState.resetAppState();
    appState.setExternalFilesSettings(defaultExternalFiles);
    checkDocumentIfDeferredMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips deferred checks when tab activation checks are disabled", async () => {
    appState.setExternalFilesSettings({
      ...defaultExternalFiles,
      checkOnTabActivate: false,
    });
    appState.openFileInTab("/tmp/a.ts", "a");
    const tabId = activeFileTabIdByPath("/tmp/a.ts");
    const handlers = createAppShellFileHandlers({
      getCurrentWindowId: () => "win-1",
      getRuntimeReady: () => true,
      notify: () => {},
    });

    await handlers.onTabActivated(tabId);

    expect(checkDocumentIfDeferredMock).not.toHaveBeenCalled();
  });

  it("dedupes same-document tab activations during cooldown", async () => {
    appState.openFileInTab("/tmp/a.ts", "a");
    const documentId = appState.findDocumentIdByPath("/tmp/a.ts");
    const tabId = activeFileTabIdByPath("/tmp/a.ts");
    const handlers = createAppShellFileHandlers({
      getCurrentWindowId: () => "win-1",
      getRuntimeReady: () => true,
      notify: () => {},
    });

    await handlers.onTabActivated(tabId);
    await handlers.onTabActivated(tabId);

    expect(checkDocumentIfDeferredMock).toHaveBeenCalledTimes(1);
    expect(checkDocumentIfDeferredMock).toHaveBeenCalledWith(documentId, "tab");

    vi.setSystemTime(650);
    await handlers.onTabActivated(tabId);

    expect(checkDocumentIfDeferredMock).toHaveBeenCalledTimes(2);
  });

  it("still checks when switching to a different document within cooldown", async () => {
    appState.openFileInTab("/tmp/a.ts", "a");
    appState.openFileInTab("/tmp/b.ts", "b");
    const firstTabId = activeFileTabIdByPath("/tmp/a.ts");
    const secondTabId = activeFileTabIdByPath("/tmp/b.ts");
    const firstDocumentId = appState.findDocumentIdByPath("/tmp/a.ts");
    const secondDocumentId = appState.findDocumentIdByPath("/tmp/b.ts");
    const handlers = createAppShellFileHandlers({
      getCurrentWindowId: () => "win-1",
      getRuntimeReady: () => true,
      notify: () => {},
    });

    await handlers.onTabActivated(firstTabId);
    await handlers.onTabActivated(secondTabId);

    expect(checkDocumentIfDeferredMock).toHaveBeenCalledTimes(2);
    expect(checkDocumentIfDeferredMock).toHaveBeenNthCalledWith(1, firstDocumentId, "tab");
    expect(checkDocumentIfDeferredMock).toHaveBeenNthCalledWith(2, secondDocumentId, "tab");
  });
});
