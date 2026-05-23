import { beforeEach, describe, expect, it } from "vitest";
import { appState } from "./appState";

describe("appState tabs and selection", () => {
  beforeEach(() => {
    appState.resetWorkspace();
  });

  it("createTab adds a document and selects it", () => {
    appState.createTab();
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(2);
    expect(snapshot.documents).toHaveLength(2);
    expect(snapshot.session.selectedTabId).toBe("tab-2");
  });

  it("selectTab ignores unknown tab ids", () => {
    appState.selectTab("tab-missing");
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-1");
  });

  it("selectOrReopenTabForDocument selects an open tab", () => {
    appState.createTab();
    appState.selectTab("tab-1");
    appState.selectOrReopenTabForDocument("doc-2");
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-2");
  });

  it("selectOrReopenTabForDocument reopens a closed document in a new tab", () => {
    appState.openFileInTab("/tmp/notes.txt", "notes");
    const documentId = appState.findDocumentIdByPath("/tmp/notes.txt");
    expect(documentId).not.toBeNull();
    appState.closeTabForce("tab-2");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);

    appState.selectOrReopenTabForDocument(documentId!);
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(2);
    expect(snapshot.session.selectedTabId).toBe("tab-3");
  });

  it("closeTab cannot remove the last remaining tab", () => {
    appState.closeTab("tab-1");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);
  });

  it("closeTab removes a tab when more than one is open", () => {
    appState.createTab();
    appState.closeTab("tab-2");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-1");
  });

  it("closeTabForce creates a new untitled tab when the last tab closes", () => {
    appState.closeTabForce("tab-1");
    const snapshot = appState.getSnapshot();
    expect(snapshot.session.openTabs).toHaveLength(1);
    expect(snapshot.documents[0]?.title).toBe("Untitled");
  });

  it("reorderTabs moves tabs and ignores invalid indices", () => {
    appState.createTab();
    appState.reorderTabs(1, 0);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual([
      "tab-2",
      "tab-1",
    ]);

    appState.reorderTabs(-1, 0);
    expect(appState.getSnapshot().session.openTabs.map((tab) => tab.id)).toEqual([
      "tab-2",
      "tab-1",
    ]);
  });

  it("transferActiveTabOut and openTransferredTab round-trip tab payload", () => {
    appState.openFileInTab("/tmp/move-me.txt", "payload");
    const transfer = appState.transferActiveTabOut();
    expect(transfer).toEqual({
      filePath: "/tmp/move-me.txt",
      content: "payload",
      title: "move-me.txt",
    });
    expect(appState.getSnapshot().session.openTabs).toHaveLength(1);

    const documentId = appState.openTransferredTab(transfer!);
    expect(documentId).toBe("doc-2");
    expect(appState.getSnapshot().session.openTabs).toHaveLength(2);
    expect(appState.getSnapshot().session.selectedTabId).toBe("tab-3");
  });
});

describe("appState documents and paths", () => {
  beforeEach(() => {
    appState.resetWorkspace();
  });

  it("openFileInTab opens a new saved document", () => {
    appState.openFileInTab("/tmp/readme.md", "# Title");
    const snapshot = appState.getSnapshot();
    const document = snapshot.documents.find((doc) => doc.filePath === "/tmp/readme.md");
    expect(document?.content).toBe("# Title");
    expect(document?.language).toBe("markdown");
    expect(snapshot.recentFiles[0]).toBe("/tmp/readme.md");
  });

  it("openFileInTab selects an existing document for duplicate paths", () => {
    appState.openFileInTab("/tmp/dup.txt", "first");
    appState.openFileInTab("/tmp/dup.txt", "second");
    const snapshot = appState.getSnapshot();
    expect(snapshot.documents.filter((doc) => doc.filePath === "/tmp/dup.txt")).toHaveLength(1);
    expect(snapshot.session.selectedTabId).toBe("tab-2");
  });

  it("findDocumentIdByPath returns null for untitled documents", () => {
    expect(appState.findDocumentIdByPath("/tmp/missing.txt")).toBeNull();
  });

  it("setDocumentContent marks documents dirty and detects CRLF", () => {
    appState.setDocumentContent("doc-1", "line\r\n");
    const document = appState.getSnapshot().documents[0];
    expect(document?.isDirty).toBe(true);
    expect(document?.lineEnding).toBe("crlf");
  });

  it("markDocumentSaved clears dirty state and updates metadata", () => {
    appState.setDocumentContent("doc-1", "draft");
    appState.markDocumentSaved("doc-1", "/tmp/saved.txt", "draft");
    const document = appState.getSnapshot().documents[0];
    expect(document?.isDirty).toBe(false);
    expect(document?.filePath).toBe("/tmp/saved.txt");
    expect(document?.title).toBe("saved.txt");
    expect(document?.language).toBe("plaintext");
    expect(document?.fileMissing).toBe(false);
  });

  it("refreshUntitledTitle derives title from first line", () => {
    appState.setDocumentContent("doc-1", "My Draft Title\nbody");
    appState.refreshUntitledTitle("doc-1");
    expect(appState.getSnapshot().documents[0]?.title).toBe("My Draft Title");
  });

  it("refreshUntitledTitle truncates long first lines to 64 characters", () => {
    const longLine = "x".repeat(80);
    appState.setDocumentContent("doc-1", longLine);
    appState.refreshUntitledTitle("doc-1");
    expect(appState.getSnapshot().documents[0]?.title).toHaveLength(64);
  });

  it("normalizeUntitledTitles leaves saved documents unchanged", () => {
    appState.openFileInTab("/tmp/saved.txt", "content");
    appState.normalizeUntitledTitles();
    expect(appState.getSnapshot().documents.find((doc) => doc.id === "doc-2")?.title).toBe(
      "saved.txt",
    );
  });

  it("caps recentFiles at 15 unique entries", () => {
    for (let index = 0; index < 16; index += 1) {
      appState.openFileInTab(`/tmp/file-${index}.txt`, "x");
    }
    expect(appState.getSnapshot().recentFiles).toHaveLength(15);
    expect(appState.getSnapshot().recentFiles[0]).toBe("/tmp/file-15.txt");
  });

  it("infers markdown for .markdown files on save", () => {
    appState.setDocumentContent("doc-1", "# hi");
    appState.markDocumentSaved("doc-1", "/tmp/readme.markdown", "# hi");
    expect(appState.getSnapshot().documents[0]?.language).toBe("markdown");
  });
});

describe("appState external file fields", () => {
  beforeEach(() => {
    appState.resetWorkspace();
  });

  it("applyDocumentDiskReload replaces buffer and clears dismissed/missing flags", () => {
    appState.openFileInTab("/tmp/external.txt", "old");
    appState.applyDocumentKeepLocal("doc-2", { mtimeMs: 1, sizeBytes: 1 });
    appState.setDocumentDiskState("doc-2", { diskFingerprint: null, fileMissing: true });

    appState.applyDocumentDiskReload("doc-2", "new", { mtimeMs: 2, sizeBytes: 2 });
    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document).toMatchObject({
      content: "new",
      savedContent: "new",
      isDirty: false,
      diskFingerprint: { mtimeMs: 2, sizeBytes: 2 },
      dismissedFingerprint: null,
      fileMissing: false,
    });
  });

  it("applyDocumentKeepLocal stores dismissed fingerprint only", () => {
    appState.openFileInTab("/tmp/keep.txt", "local");
    appState.setDocumentContent("doc-2", "edited");
    appState.applyDocumentKeepLocal("doc-2", { mtimeMs: 9, sizeBytes: 9 });

    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document?.dismissedFingerprint).toEqual({ mtimeMs: 9, sizeBytes: 9 });
    expect(document?.content).toBe("edited");
    expect(document?.isDirty).toBe(true);
  });

  it("setDocumentDiskState updates fingerprint and missing flag", () => {
    appState.openFileInTab("/tmp/missing.txt", "content");
    appState.setDocumentDiskState("doc-2", {
      diskFingerprint: { mtimeMs: 3, sizeBytes: 3 },
      fileMissing: true,
    });
    const document = appState.getSnapshot().documents.find((doc) => doc.id === "doc-2");
    expect(document?.diskFingerprint).toEqual({ mtimeMs: 3, sizeBytes: 3 });
    expect(document?.fileMissing).toBe(true);
  });
});

describe("appState settings and editor chrome", () => {
  beforeEach(() => {
    appState.resetWorkspace();
  });

  it("toggleTheme alternates light and dark", () => {
    expect(appState.getSnapshot().settings.themeMode).toBe("dark");
    appState.toggleTheme();
    expect(appState.getSnapshot().settings.themeMode).toBe("light");
    appState.toggleTheme();
    expect(appState.getSnapshot().settings.themeMode).toBe("dark");
  });

  it("cycleAccent rotates through accent options", () => {
    expect(appState.getSnapshot().settings.accent).toBe("blue");
    appState.cycleAccent();
    expect(appState.getSnapshot().settings.accent).toBe("violet");
    appState.cycleAccent();
    expect(appState.getSnapshot().settings.accent).toBe("green");
    appState.cycleAccent();
    expect(appState.getSnapshot().settings.accent).toBe("blue");
  });

  it("applyPersistedSettings updates only provided fields", () => {
    appState.applyPersistedSettings({ zoomPercent: 130, wrapLines: false });
    const snapshot = appState.getSnapshot();
    expect(snapshot.editor.zoomPercent).toBe(130);
    expect(snapshot.editor.wrapLines).toBe(false);
    expect(snapshot.settings.themeMode).toBe("dark");
  });

  it("setPreviewMode, zoom, and wrap update editor state", () => {
    appState.setPreviewMode("diff");
    appState.setZoomPercent(110);
    appState.toggleWrap();

    const editor = appState.getSnapshot().editor;
    expect(editor.previewMode).toBe("diff");
    expect(editor.zoomPercent).toBe(110);
    expect(editor.wrapLines).toBe(false);
  });
});
