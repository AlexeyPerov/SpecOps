import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";

vi.mock("./openFileRegistry", () => ({
  renameOpenFileRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn().mockResolvedValue({ mtimeMs: 1, sizeBytes: 2 }),
  };
});

import { renameOpenFileRegistry } from "./openFileRegistry";
import {
  closeTabsForDeletedDocumentsUnderPath,
  markDocumentsMissingUnderPath,
  syncDocumentsAfterPathRelocation,
} from "./relocateWorkspacePaths";
import { allTabs, getSessionTabs, isFileTab, normalizeTabState, tabDocumentId } from "../domain/contracts";

describe("syncDocumentsAfterPathRelocation", () => {
  beforeEach(() => {
    appState.resetAppState();
    vi.mocked(renameOpenFileRegistry).mockClear();
    const workspaceId = appState.addWorkspace("/tmp/ws-reloc");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.openFileInTab("/tmp/ws-reloc/sibling.txt", "content");
    appState.openFileInTab("/tmp/ws-reloc/old/nested.ts", "nested");
  });

  it("rewrites document paths under a relocated directory prefix", async () => {
    await syncDocumentsAfterPathRelocation(
      "/tmp/ws-reloc",
      "/tmp/ws-reloc/old",
      "/tmp/ws-reloc/new",
      "main",
    );

    const docs = appState.getActiveDocuments();
    const paths = docs.map((doc) => doc.filePath).filter(Boolean).sort();
    expect(paths).toEqual(["/tmp/ws-reloc/new/nested.ts", "/tmp/ws-reloc/sibling.txt"]);
    expect(renameOpenFileRegistry).toHaveBeenCalled();
  });
});

describe("markDocumentsMissingUnderPath", () => {
  beforeEach(() => {
    appState.resetAppState();
    const workspaceId = appState.addWorkspace("/tmp/ws-del");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.openFileInTab("/tmp/ws-del/old/nested.ts", "nested");
  });

  it("marks documents missing when a path prefix is deleted", () => {
    const docId = appState.getActiveDocuments().find((doc) => doc.filePath?.includes("nested.ts"))?.id;
    markDocumentsMissingUnderPath("/tmp/ws-del", "/tmp/ws-del/old");
    const nested = appState.getActiveDocuments().find((doc) => doc.id === docId);
    expect(nested?.fileMissing).toBe(true);
  });

  it("closes open tabs for deleted files immediately", () => {
    const docId = appState.getActiveDocuments().find((doc) => doc.filePath?.includes("nested.ts"))?.id;
    expect(docId).toBeDefined();
    expect(
      getSessionTabs(appState.getActiveSession()).some((tab) => isFileTab(normalizeTabState(tab)) && tabDocumentId(tab) === docId),
    ).toBe(true);

    closeTabsForDeletedDocumentsUnderPath("/tmp/ws-del", "/tmp/ws-del/old/nested.ts");

    expect(
      getSessionTabs(appState.getActiveSession()).some((tab) => isFileTab(normalizeTabState(tab)) && tabDocumentId(tab) === docId),
    ).toBe(false);
  });

  it("closes deleted-file tabs owned by a sibling pane", () => {
    const docId = appState.getActiveDocuments().find((doc) => doc.filePath?.includes("nested.ts"))?.id;
    const tab = allTabs(appState.getActiveSession().editorLayout).find(
      (entry) => isFileTab(entry) && entry.documentId === docId,
    );
    appState.setEditorLayout("cols-2");
    const layout = appState.getActiveSession().editorLayout;
    const sourcePane = layout.panes.find((pane) => pane.tabs.some((entry) => entry.id === tab!.id))!;
    const activePane = layout.panes.find((pane) => pane.id !== sourcePane.id)!;
    appState.setActiveEditorPane(activePane.id);

    closeTabsForDeletedDocumentsUnderPath("/tmp/ws-del", "/tmp/ws-del/old/nested.ts");

    expect(
      allTabs(appState.getActiveSession().editorLayout).some((entry) => entry.id === tab!.id),
    ).toBe(false);
  });
});
