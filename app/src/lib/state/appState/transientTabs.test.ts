import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionTabs, isFileTab } from "../../domain/contracts";
import { appState } from "../appState";
import { saveThemeFile } from "../../services/themeStore";

vi.mock("../../services/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});
void saveThemeFile;

function fileTabs() {
  return getSessionTabs(appState.getActiveSession()).filter(isFileTab);
}

function tabForDocument(documentId: string) {
  return fileTabs().find((tab) => tab.documentId === documentId);
}

describe("transient (preview) tabs", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("marks a tab transient and clears the flag from its pane siblings", () => {
    const firstDoc = appState.openFileInTab("/tmp/a.txt", "a");
    const secondDoc = appState.openFileInTab("/tmp/b.txt", "b");
    const firstTab = tabForDocument(firstDoc)!;
    const secondTab = tabForDocument(secondDoc)!;

    appState.setFileTabTransient(firstTab.id, true);
    appState.setFileTabTransient(secondTab.id, true);

    expect(tabForDocument(firstDoc)?.transient).toBeUndefined();
    expect(tabForDocument(secondDoc)?.transient).toBe(true);
  });

  it("promotes the transient tab when the document is edited", () => {
    const documentId = appState.openFileInTab("/tmp/edit.txt", "hello");
    appState.setFileTabTransient(tabForDocument(documentId)!.id, true);

    appState.setDocumentContent(documentId, "hello world");

    expect(tabForDocument(documentId)?.transient).toBeUndefined();
    expect(appState.getActiveDocuments().find((doc) => doc.id === documentId)?.isDirty).toBe(true);
  });

  it("promotes by document id (caret move, explicit reopen)", () => {
    const documentId = appState.openFileInTab("/tmp/caret.txt", "hello");
    appState.setFileTabTransient(tabForDocument(documentId)!.id, true);

    appState.promoteTransientTabForDocument(documentId);

    expect(tabForDocument(documentId)?.transient).toBeUndefined();
  });

  it("leaves ordinary tabs untouched when promoting", () => {
    const documentId = appState.openFileInTab("/tmp/plain.txt", "hello");
    const before = appState.getActiveSession().editorLayout;

    appState.promoteTransientTabForDocument(documentId);

    // Same layout reference: promotion of a non-transient tab allocates nothing.
    expect(appState.getActiveSession().editorLayout).toBe(before);
  });

  it("clearing the flag leaves the tab open", () => {
    const documentId = appState.openFileInTab("/tmp/keep.txt", "hello");
    const tabId = tabForDocument(documentId)!.id;

    appState.setFileTabTransient(tabId, true);
    appState.setFileTabTransient(tabId, false);

    expect(tabForDocument(documentId)).toBeDefined();
    expect(tabForDocument(documentId)?.transient).toBeUndefined();
  });
});
