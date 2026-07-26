import { beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../state/appState";
import { getSessionTabs, isFileTab, normalizeTabState, tabDocumentId } from "../domain/contracts";

vi.mock("./logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./sessionManager", () => ({
  notifyTabsChangedForSession: vi.fn(),
}));

import { removeInaccessibleDocumentTab } from "./inaccessibleFileTabs";
import { logDiagnostic } from "./logging";
import { notifyTabsChangedForSession } from "./sessionManager";

const logDiagnosticMock = vi.mocked(logDiagnostic);
const notifyTabsChangedMock = vi.mocked(notifyTabsChangedForSession);

function openedDocId(pathFragment: string): string {
  const id = appState
    .getActiveDocuments()
    .find((doc) => doc.filePath?.includes(pathFragment))?.id;
  expect(id).toBeDefined();
  return id!;
}

function hasTabForDocument(documentId: string): boolean {
  return getSessionTabs(appState.getActiveSession()).some(
    (tab) => isFileTab(normalizeTabState(tab)) && tabDocumentId(tab) === documentId,
  );
}

describe("removeInaccessibleDocumentTab", () => {
  beforeEach(() => {
    appState.resetAppState();
    logDiagnosticMock.mockClear();
    notifyTabsChangedMock.mockClear();
    const workspaceId = appState.addWorkspace("/tmp/ws-inaccessible");
    expect(workspaceId).not.toBeNull();
    appState.switchContext(workspaceId!);
    appState.openFileInTab("/tmp/ws-inaccessible/a.txt", "content");
  });

  it("closes the tab for a clean document", () => {
    const docId = openedDocId("a.txt");

    removeInaccessibleDocumentTab(docId, "/tmp/ws-inaccessible/a.txt", new Error("scope denied"));

    expect(hasTabForDocument(docId)).toBe(false);
    expect(notifyTabsChangedMock).toHaveBeenCalled();
  });

  it("keeps a dirty document's tab and marks it missing instead", () => {
    const docId = openedDocId("a.txt");
    appState.setDocumentContent(docId, "unsaved edits");

    removeInaccessibleDocumentTab(docId, "/tmp/ws-inaccessible/a.txt", new Error("scope denied"));

    expect(hasTabForDocument(docId)).toBe(true);
    const doc = appState.getActiveDocuments().find((entry) => entry.id === docId);
    expect(doc?.isDirty).toBe(true);
    expect(doc?.fileMissing).toBe(true);
    expect(notifyTabsChangedMock).not.toHaveBeenCalled();
  });

  it("is idempotent for a dirty document (no repeated state writes or logs)", () => {
    const docId = openedDocId("a.txt");
    appState.setDocumentContent(docId, "unsaved edits");

    removeInaccessibleDocumentTab(docId, "/tmp/ws-inaccessible/a.txt", new Error("scope denied"));
    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);

    // Callers retry on every focus/watcher check; retries must be no-ops.
    removeInaccessibleDocumentTab(docId, "/tmp/ws-inaccessible/a.txt", new Error("scope denied"));
    removeInaccessibleDocumentTab(docId, "/tmp/ws-inaccessible/a.txt", new Error("scope denied"));

    expect(hasTabForDocument(docId)).toBe(true);
    expect(logDiagnosticMock).toHaveBeenCalledTimes(1);
  });
});
