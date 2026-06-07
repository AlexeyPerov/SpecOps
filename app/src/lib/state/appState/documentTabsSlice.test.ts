import { beforeEach, describe, expect, it } from "vitest";
import { createFileTab } from "../../domain/contracts";
import { appState } from "../appState";

function notepadSnapshot() {
  return appState.getSnapshot().contexts.notepad;
}

function workspaceSnapshot(workspaceId = "ws-1") {
  return appState.getSnapshot().contexts.workspaces.find((entry) => entry.id === workspaceId)?.snapshot;
}

describe("appState documentTabsSlice", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  describe("migrateNotepadFileTabToWorkspace", () => {
    it("moves a notepad file tab into the active workspace with the same document", () => {
      appState.addWorkspace("/tmp/ws");
      appState.switchContext("notepad");
      appState.openFileInTab("/tmp/ws/migrate-me.txt", "local edits");
      const notepadDocId = notepadSnapshot().documents.find((doc) => doc.filePath === "/tmp/ws/migrate-me.txt")?.id;
      const notepadTabId = notepadSnapshot().session.selectedTabId;
      appState.setDocumentContent(notepadDocId!, "local edits changed");

      const migratedDocumentId = appState.migrateNotepadFileTabToWorkspace("/tmp/ws/migrate-me.txt", "ws-1");

      expect(migratedDocumentId).toBe(notepadDocId);
      expect(appState.getSnapshot().contexts.activeContextId).toBe("ws-1");
      const workspaceDoc = workspaceSnapshot()?.documents.find((doc) => doc.id === notepadDocId);
      expect(workspaceDoc).toMatchObject({
        filePath: "/tmp/ws/migrate-me.txt",
        content: "local edits changed",
        isDirty: true,
      });
      expect(workspaceSnapshot()?.session.openTabs.some((tab) => tab.kind === "file" && tab.documentId === notepadDocId)).toBe(
        true,
      );
      expect(
        notepadSnapshot().session.openTabs.some((tab) => tab.kind === "file" && tab.documentId === notepadDocId),
      ).toBe(false);
      expect(notepadSnapshot().session.openTabs.some((tab) => tab.id === notepadTabId)).toBe(false);
      expect(appState.getSnapshot().editor.findReplaceOpen).toBe(false);
      expect(appState.getSnapshot().editor.goToOpen).toBe(false);
      expect(appState.getSnapshot().editor.previewMode).toBe("editor");
    });

    it("focuses an existing workspace tab when the path is already open there", () => {
      appState.addWorkspace("/tmp/ws");
      appState.openFileInTab("/tmp/ws/existing.txt", "workspace copy");
      const workspaceDocId = workspaceSnapshot()?.documents.find((doc) => doc.filePath === "/tmp/ws/existing.txt")?.id;
      const workspaceTabId = workspaceSnapshot()?.session.selectedTabId;

      appState.switchContext("notepad");
      appState.openFileInTab("/tmp/ws/existing.txt", "notepad copy");
      const notepadDocId = notepadSnapshot().documents.find((doc) => doc.filePath === "/tmp/ws/existing.txt")?.id;
      const workspaceTabCountBefore = workspaceSnapshot()?.session.openTabs.length;

      const migratedDocumentId = appState.migrateNotepadFileTabToWorkspace("/tmp/ws/existing.txt", "ws-1");

      expect(migratedDocumentId).toBe(workspaceDocId);
      expect(notepadDocId).not.toBe(workspaceDocId);
      expect(appState.getSnapshot().contexts.activeContextId).toBe("ws-1");
      expect(workspaceSnapshot()?.session.selectedTabId).toBe(workspaceTabId);
      expect(workspaceSnapshot()?.session.openTabs).toHaveLength(workspaceTabCountBefore);
      expect(
        workspaceSnapshot()?.session.openTabs.filter(
          (tab) => tab.kind === "file" && tab.documentId === workspaceDocId,
        ),
      ).toHaveLength(1);
      expect(
        notepadSnapshot().session.openTabs.some(
          (tab) => tab.kind === "file" && tab.documentId === notepadDocId,
        ),
      ).toBe(true);
    });

    it("returns null when the path is outside the workspace root or no notepad tab exists", () => {
      appState.addWorkspace("/tmp/ws");
      appState.switchContext("notepad");
      appState.openFileInTab("/tmp/outside.txt", "outside");

      expect(appState.migrateNotepadFileTabToWorkspace("/tmp/outside.txt", "ws-1")).toBeNull();
      expect(appState.migrateNotepadFileTabToWorkspace("/tmp/ws/missing.txt", "ws-1")).toBeNull();
      expect(appState.migrateNotepadFileTabToWorkspace("/tmp/ws/missing.txt", "ws-missing")).toBeNull();
    });
  });

  describe("renameDocument", () => {
    it("updates file path, title, language, and recent files in the active context", () => {
      appState.openFileInTab("/tmp/old-name.ts", "export const value = 1;");
      const documentId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/old-name.ts")?.id;
      expect(documentId).toBeDefined();

      appState.renameDocument(documentId!, "/tmp/new-name.tsx", "new-name.tsx");

      const document = appState.getActiveDocuments().find((doc) => doc.id === documentId);
      expect(document).toMatchObject({
        filePath: "/tmp/new-name.tsx",
        title: "new-name.tsx",
        language: "typescript",
      });
      expect(appState.getSnapshot().recentFiles[0]).toBe("/tmp/new-name.tsx");
      expect(appState.getSnapshot().recentFiles).toContain("/tmp/old-name.ts");
    });

    it("renames only the targeted document in a multi-tab session", () => {
      appState.openFileInTab("/tmp/keep.txt", "keep");
      appState.openFileInTab("/tmp/rename.txt", "rename");
      const renameDocId = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/rename.txt")?.id;

      appState.renameDocument(renameDocId!, "/tmp/renamed.txt", "renamed.txt");

      expect(appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/keep.txt")?.title).toBe("keep.txt");
      expect(appState.getActiveDocuments().find((doc) => doc.id === renameDocId)?.filePath).toBe("/tmp/renamed.txt");
    });

    it("renames workspace documents without affecting notepad state", () => {
      appState.addWorkspace("/tmp/ws");
      appState.openFileInTab("/tmp/ws/file.ts", "workspace");
      const workspaceDocId = workspaceSnapshot()?.documents.find((doc) => doc.filePath === "/tmp/ws/file.ts")?.id;

      appState.switchContext("notepad");
      appState.applyWindowSession({
        ...appState.getWindowSessionSnapshot(),
        notepad: {
          documents: [
            {
              id: "doc-notepad",
              filePath: "/tmp/notepad.ts",
              title: "notepad.ts",
              content: "notepad",
              savedContent: "notepad",
              isDirty: false,
              contentKind: "text",
              language: "typescript",
              encoding: "utf-8",
              lineEnding: "lf",
              diskFingerprint: null,
              dismissedFingerprint: null,
              fileMissing: false,
              scrollTop: 0,
              markdownViewMode: "edit",
            },
          ],
          session: {
            selectedTabId: "tab-notepad",
            openTabs: [createFileTab("tab-notepad", "doc-notepad")],
            lastActiveWindowId: "main",
            windowBounds: null,
          },
        },
      });

      appState.switchContext("ws-1");
      appState.renameDocument(workspaceDocId!, "/tmp/ws/renamed.ts", "renamed.ts");

      const workspaceDoc = workspaceSnapshot()?.documents.find((doc) => doc.id === workspaceDocId);
      expect(workspaceDoc?.filePath).toBe("/tmp/ws/renamed.ts");
      expect(notepadSnapshot().documents.find((doc) => doc.id === "doc-notepad")?.filePath).toBe("/tmp/notepad.ts");
    });
  });
});
