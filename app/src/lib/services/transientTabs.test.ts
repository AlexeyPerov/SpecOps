import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionTabs, isFileTab } from "../domain/contracts";
import { appState } from "../state/appState";
import {
  captureActivePaneTransientTab,
  completeTransientOpen,
} from "./transientTabs";

vi.mock("./externalFileChanges", () => ({
  clearDocumentExternalChangeState: vi.fn(),
}));

vi.mock("./themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});

function fileTabs() {
  return getSessionTabs(appState.getActiveSession()).filter(isFileTab);
}

function openPreview(path: string, content = ""): string {
  const previous = captureActivePaneTransientTab();
  const documentId = appState.openFileInTab(path, content);
  completeTransientOpen(documentId, previous);
  return documentId;
}

describe("transient open flow", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("reuses the preview slot instead of stacking tabs", () => {
    const first = openPreview("/tmp/one.txt");
    const tabCountAfterFirst = fileTabs().length;

    const second = openPreview("/tmp/two.txt");

    expect(fileTabs().length).toBe(tabCountAfterFirst);
    expect(fileTabs().some((tab) => tab.documentId === first)).toBe(false);
    const secondTab = fileTabs().find((tab) => tab.documentId === second);
    expect(secondTab?.transient).toBe(true);
  });

  it("puts the replacement where the replaced preview was", () => {
    const kept = appState.openFileInTab("/tmp/kept.txt", "kept");
    const first = openPreview("/tmp/one.txt");
    const previewIndex = fileTabs().findIndex((tab) => tab.documentId === first);

    const second = openPreview("/tmp/two.txt");

    expect(fileTabs().findIndex((tab) => tab.documentId === second)).toBe(previewIndex);
    expect(fileTabs().some((tab) => tab.documentId === kept)).toBe(true);
  });

  it("keeps a preview with unsaved edits and opens the next file beside it", () => {
    const edited = openPreview("/tmp/edited.txt", "hello");
    appState.setDocumentContent(edited, "hello world");
    // The edit itself promotes the tab; re-flag it to exercise the dirty guard
    // on its own (a file made dirty by an external reload, say).
    const editedTabId = fileTabs().find((tab) => tab.documentId === edited)!.id;
    appState.setFileTabTransient(editedTabId, true);

    const next = openPreview("/tmp/next.txt");

    expect(fileTabs().some((tab) => tab.documentId === edited)).toBe(true);
    expect(fileTabs().find((tab) => tab.documentId === edited)?.transient).toBeUndefined();
    expect(fileTabs().find((tab) => tab.documentId === next)?.transient).toBe(true);
  });

  it("does nothing when the same file is previewed twice", () => {
    const documentId = openPreview("/tmp/same.txt");

    const again = openPreview("/tmp/same.txt");

    expect(again).toBe(documentId);
    expect(fileTabs().filter((tab) => tab.documentId === documentId)).toHaveLength(1);
    expect(fileTabs().find((tab) => tab.documentId === documentId)?.transient).toBe(true);
  });
});
