import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTab, createFileTab, isAgentTab, tabDocumentId } from "../../domain/contracts";
import { appState, resetThemePersistenceForTests, setThemeSaveErrorNotifier } from "../appState";
import { saveThemeFile } from "../../services/themeStore";
import {
  defaultProviderModelCatalogs,
  getProviderDefaultModelId,
} from "../../ai/providers/providerModelCatalog";

vi.mock("../../services/themeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/themeStore")>();
  return {
    ...actual,
    loadThemeFile: vi.fn().mockResolvedValue(actual.defaultThemeFile),
    saveThemeFile: vi.fn().mockResolvedValue(undefined),
  };
});

const saveThemeFileMock = vi.mocked(saveThemeFile);

describe("appState documents and paths", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("openFileInTab opens a new saved document", () => {
    appState.openFileInTab("/tmp/readme.md", "# Title");
    const snapshot = appState.getSnapshot();
    const document = appState.getActiveDocuments().find((doc) => doc.filePath === "/tmp/readme.md");
    expect(document?.content).toBe("# Title");
    expect(document?.language).toBe("markdown");
    expect(snapshot.recentFiles[0]).toBe("/tmp/readme.md");
  });

  it("openFileInTab selects an existing document for duplicate paths", () => {
    appState.openFileInTab("/tmp/dup.txt", "first");
    appState.openFileInTab("/tmp/other.txt", "other");
    appState.openFileInTab("/tmp/dup.txt", "second");
    const snapshot = appState.getSnapshot();
    expect(appState.getActiveDocuments().filter((doc) => doc.filePath === "/tmp/dup.txt")).toHaveLength(1);
    expect(appState.getActiveSession().selectedTabId).toBe("tab-2");
    expect(snapshot.recentFiles[0]).toBe("/tmp/dup.txt");
  });

  it("findDocumentIdByPath returns null for untitled documents", () => {
    expect(appState.findDocumentIdByPath("/tmp/missing.txt")).toBeNull();
  });

  it("setDocumentContent marks documents dirty and detects CRLF", () => {
    appState.setDocumentContent("doc-1", "line\r\n");
    const document = appState.getActiveDocuments()[0];
    expect(document?.isDirty).toBe(true);
    expect(document?.lineEnding).toBe("crlf");
  });

  it("markDocumentSaved clears dirty state and updates metadata", () => {
    appState.setDocumentContent("doc-1", "draft");
    appState.markDocumentSaved("doc-1", "/tmp/saved.txt", "draft");
    const document = appState.getActiveDocuments()[0];
    expect(document?.isDirty).toBe(false);
    expect(document?.filePath).toBe("/tmp/saved.txt");
    expect(document?.title).toBe("saved.txt");
    expect(document?.language).toBe("plaintext");
    expect(document?.fileMissing).toBe(false);
  });

  it("refreshUntitledTitle derives title from first line", () => {
    appState.setDocumentContent("doc-1", "My Draft Title\nbody");
    appState.refreshUntitledTitle("doc-1");
    expect(appState.getActiveDocuments()[0]?.title).toBe("My Draft Title");
  });

  it("refreshUntitledTitle truncates long first lines to 64 characters", () => {
    const longLine = "x".repeat(80);
    appState.setDocumentContent("doc-1", longLine);
    appState.refreshUntitledTitle("doc-1");
    expect(appState.getActiveDocuments()[0]?.title).toHaveLength(64);
  });

  it("normalizeUntitledTitles leaves saved documents unchanged", () => {
    appState.openFileInTab("/tmp/saved.txt", "content");
    appState.normalizeUntitledTitles();
    expect(appState.getActiveDocuments().find((doc) => doc.id === "doc-2")?.title).toBe(
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
    expect(appState.getActiveDocuments()[0]?.language).toBe("markdown");
  });
});

describe("appState external file fields", () => {
  beforeEach(() => {
    appState.resetAppState();
  });

  it("applyDocumentDiskReload replaces buffer and clears dismissed/missing flags", () => {
    appState.openFileInTab("/tmp/external.txt", "old");
    appState.applyDocumentKeepLocal("doc-2", { mtimeMs: 1, sizeBytes: 1 });
    appState.setDocumentDiskState("doc-2", { diskFingerprint: null, fileMissing: true });

    appState.applyDocumentDiskReload("doc-2", "new", { mtimeMs: 2, sizeBytes: 2 });
    const document = appState.getActiveDocuments().find((doc) => doc.id === "doc-2");
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

    const document = appState.getActiveDocuments().find((doc) => doc.id === "doc-2");
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
    const document = appState.getActiveDocuments().find((doc) => doc.id === "doc-2");
    expect(document?.diskFingerprint).toEqual({ mtimeMs: 3, sizeBytes: 3 });
    expect(document?.fileMissing).toBe(true);
  });

  it("setDocumentMarkdownViewMode stores per-document markdown view mode", () => {
    appState.openFileInTab("/tmp/readme.md", "# Hello");
    appState.setDocumentMarkdownViewMode("doc-2", "preview");
    const document = appState.getActiveDocuments().find((doc) => doc.id === "doc-2");
    expect(document?.markdownViewMode).toBe("preview");
  });
});

