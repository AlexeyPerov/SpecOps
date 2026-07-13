import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "../state/appState";
import {
  decideReplaceAllForPath,
  syncOpenDocumentAfterReplace,
} from "./projectReplaceSync";

/** Find an open document id by its file path in the active context. */
function docIdByPath(filePath: string): string {
  const id = appState.findDocumentIdByPath(filePath);
  if (!id) {
    throw new Error(`no open document for ${filePath}`);
  }
  return id;
}

describe("decideReplaceAllForPath", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("skips a file whose open document is dirty", () => {
    const wsId = appState.addWorkspace("/tmp/ws");
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = docIdByPath("/tmp/ws/a.txt");
    appState.setDocumentContent(documentId, "edited");

    expect(decideReplaceAllForPath("/tmp/ws/a.txt")).toEqual({
      kind: "skip-dirty",
      contextId: wsId,
      documentId,
    });
  });

  it("proceeds for a file whose open document is clean", () => {
    appState.addWorkspace("/tmp/ws");
    appState.openFileInTab("/tmp/ws/a.txt", "content");

    expect(decideReplaceAllForPath("/tmp/ws/a.txt")).toEqual({ kind: "proceed" });
  });

  it("proceeds for a file with no open document", () => {
    appState.addWorkspace("/tmp/ws");
    expect(decideReplaceAllForPath("/tmp/ws/closed.txt")).toEqual({ kind: "proceed" });
  });

  it("skips a dirty document in an inactive workspace", () => {
    const wsAId = appState.addWorkspace("/tmp/ws-a");
    appState.openFileInTab("/tmp/ws-a/a.txt", "old");
    const wsADocId = docIdByPath("/tmp/ws-a/a.txt");
    appState.setDocumentContent(wsADocId, "dirty");
    // Switch active context away from ws-a.
    appState.addWorkspace("/tmp/ws-b");
    expect(appState.getSnapshot().contexts.activeContextId).not.toBe(wsAId);

    expect(decideReplaceAllForPath("/tmp/ws-a/a.txt")).toEqual({
      kind: "skip-dirty",
      contextId: wsAId,
      documentId: wsADocId,
    });
  });
});

describe("syncOpenDocumentAfterReplace", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("updates a clean open document with the replaced content and clears dirty state", () => {
    appState.addWorkspace("/tmp/ws");
    appState.openFileInTab("/tmp/ws/a.txt", "old");
    const documentId = docIdByPath("/tmp/ws/a.txt");
    appState.setDocumentDiskState(documentId, {
      diskFingerprint: { mtimeMs: 1, sizeBytes: 3 },
      fileMissing: false,
    });

    const fingerprint = { mtimeMs: 9, sizeBytes: 6 };
    syncOpenDocumentAfterReplace("/tmp/ws/a.txt", "newcontent", fingerprint);

    const updated = appState.getActiveDocuments().find((doc) => doc.id === documentId)!;
    expect(updated.content).toBe("newcontent");
    expect(updated.isDirty).toBe(false);
    expect(updated.diskFingerprint).toEqual(fingerprint);
  });

  it("is a no-op when no document is open for the path", () => {
    appState.addWorkspace("/tmp/ws");
    expect(() =>
      syncOpenDocumentAfterReplace("/tmp/ws/none.txt", "x", {
        mtimeMs: 1,
        sizeBytes: 1,
      }),
    ).not.toThrow();
  });

  it("syncs a document in an inactive workspace", () => {
    const wsAId = appState.addWorkspace("/tmp/ws-a");
    appState.openFileInTab("/tmp/ws-a/a.txt", "old");
    const wsADocId = docIdByPath("/tmp/ws-a/a.txt");
    appState.addWorkspace("/tmp/ws-b");
    expect(appState.getSnapshot().contexts.activeContextId).not.toBe(wsAId);

    syncOpenDocumentAfterReplace("/tmp/ws-a/a.txt", "replaced", {
      mtimeMs: 7,
      sizeBytes: 8,
    });

    const wsA = appState.getSnapshot().contexts.workspaces.find((ws) => ws.id === wsAId);
    const updated = wsA?.snapshot.documents.find((doc) => doc.id === wsADocId)!;
    expect(updated.content).toBe("replaced");
    expect(updated.isDirty).toBe(false);
  });
});
