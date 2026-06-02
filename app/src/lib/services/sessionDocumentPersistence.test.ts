import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentState } from "../domain/contracts";
import {
  documentForSessionPersistence,
  needsDocumentRefreshFromDisk,
  refreshDocumentFromDiskIfNeeded,
  stripWindowSnapshotForSession,
} from "./sessionDocumentPersistence";
import { openPath } from "./fileSystem";

vi.mock("./fileSystem", () => ({
  openPath: vi.fn(),
}));

const openPathMock = vi.mocked(openPath);

function baseDocument(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    filePath: "/tmp/photo.png",
    title: "photo.png",
    content: "bogus",
    savedContent: "bogus",
    isDirty: true,
    contentKind: "text",
    language: "plaintext",
    encoding: "utf-8",
    lineEnding: "lf",
    diskFingerprint: null,
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
    ...overrides,
  };
}

describe("documentForSessionPersistence", () => {
  it("strips buffers for image and binary documents", () => {
    const image = documentForSessionPersistence(
      baseDocument({ contentKind: "image", content: "", isDirty: false }),
    );
    expect(image.content).toBe("");
    expect(image.savedContent).toBe("");

    const binary = documentForSessionPersistence(
      baseDocument({
        filePath: "/tmp/app.bin",
        contentKind: "binary",
        content: "x",
        savedContent: "x",
        isDirty: true,
      }),
    );
    expect(binary.content).toBe("");
    expect(binary.isDirty).toBe(false);
    expect(binary.contentKind).toBe("binary");
  });

  it("strips legacy image paths stored as text", () => {
    const stripped = documentForSessionPersistence(baseDocument());
    expect(stripped.content).toBe("");
    expect(stripped.contentKind).toBe("image");
    expect(stripped.isDirty).toBe(false);
  });

  it("keeps text document content", () => {
    const doc = baseDocument({
      filePath: "/tmp/readme.md",
      content: "hello",
      contentKind: "text",
    });
    const persisted = documentForSessionPersistence(doc);
    expect(persisted.content).toBe("hello");
  });
});

describe("stripWindowSnapshotForSession", () => {
  it("strips documents in notepad and workspaces", () => {
    const stripped = stripWindowSnapshotForSession({
      activeContextId: "notepad",
      notepad: {
        documents: [baseDocument()],
        session: {
          selectedTabId: "tab-1",
          openTabs: [],
          lastActiveWindowId: "main",
          windowBounds: null,
        },
      },
      workspaces: [
        {
          id: "ws-1",
          rootPath: "/tmp/ws",
          snapshot: {
            documents: [baseDocument({ id: "doc-2" })],
            session: {
              selectedTabId: null,
              openTabs: [],
              lastActiveWindowId: "main",
              windowBounds: null,
            },
          },
        },
      ],
      editorPreferences: { zoomPercent: 100, wrapLines: true },
    });
    expect(stripped.notepad.documents[0]?.content).toBe("");
    expect(stripped.workspaces[0]?.snapshot.documents[0]?.contentKind).toBe("image");
  });
});

describe("refreshDocumentFromDiskIfNeeded", () => {
  beforeEach(() => {
    openPathMock.mockReset();
  });

  const isMissing = (error: unknown) =>
    String(error).toLowerCase().includes("no such file");

  it("re-reads image and legacy text-on-image sessions", async () => {
    openPathMock.mockResolvedValue({
      path: "/tmp/photo.png",
      content: "",
      sizeBytes: 100,
      contentKind: "image",
    });

    const legacy = await refreshDocumentFromDiskIfNeeded(baseDocument(), isMissing);
    expect(legacy.contentKind).toBe("image");
    expect(legacy.content).toBe("");
    expect(openPathMock).toHaveBeenCalledWith("/tmp/photo.png");

    openPathMock.mockClear();
    const image = await refreshDocumentFromDiskIfNeeded(
      baseDocument({ contentKind: "image", content: "stale", isDirty: true }),
      isMissing,
    );
    expect(image.content).toBe("");
    expect(image.isDirty).toBe(false);
  });

  it("leaves normal text documents unchanged", async () => {
    const doc = baseDocument({
      filePath: "/tmp/readme.md",
      content: "saved",
      contentKind: "text",
    });
    const result = await refreshDocumentFromDiskIfNeeded(doc, isMissing);
    expect(result).toBe(doc);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("marks missing files and strips preview kind without disk", async () => {
    openPathMock.mockRejectedValue(new Error("no such file"));
    const missing = await refreshDocumentFromDiskIfNeeded(
      baseDocument({ contentKind: "image" }),
      isMissing,
    );
    expect(missing.fileMissing).toBe(true);

    openPathMock.mockRejectedValue(new Error("permission denied"));
    const stripped = await refreshDocumentFromDiskIfNeeded(
      baseDocument({ content: "huge", contentKind: "text" }),
      () => false,
    );
    expect(stripped.contentKind).toBe("image");
    expect(stripped.content).toBe("");
  });
});

describe("needsDocumentRefreshFromDisk", () => {
  it("detects NUL bytes in legacy text buffers", () => {
    expect(
      needsDocumentRefreshFromDisk(
        baseDocument({ filePath: "/tmp/data.bin", content: "a\0b", contentKind: "text" }),
      ),
    ).toBe(true);
  });
});
