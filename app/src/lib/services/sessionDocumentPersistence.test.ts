import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentState } from "../domain/contracts";
import { createFileTab, createSinglePaneLayout, createViewTab, getSessionSelectedTabId, getSessionTabs } from "../domain/contracts";
import {
  applyLargeFileConfirmGateOnRestore,
  documentForSessionPersistence,
  needsDocumentRefreshFromDisk,
  refreshDocumentFromDiskIfNeeded,
  stripWindowSnapshotForSession,
} from "./sessionDocumentPersistence";
import { statDiskFingerprint } from "./diskFingerprint";
import { openPath } from "./fileSystem";

vi.mock("./fileSystem", () => ({
  openPath: vi.fn(),
}));

vi.mock("./diskFingerprint", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./diskFingerprint")>();
  return {
    ...actual,
    statDiskFingerprint: vi.fn(),
  };
});

const openPathMock = vi.mocked(openPath);
const statDiskFingerprintMock = vi.mocked(statDiskFingerprint);

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
          editorLayout: createSinglePaneLayout([], "tab-1"),
          lastActiveWindowId: "main",
          windowBounds: null,
        },
      },
      chatHttp: {
        documents: [baseDocument({ id: "doc-chat", filePath: "/tmp/chat.png" })],
        session: {
          editorLayout: createSinglePaneLayout([], "tab-chat"),
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
              editorLayout: createSinglePaneLayout([], null),
              lastActiveWindowId: "main",
              windowBounds: null,
            },
          },
        },
      ],
      editorPreferences: { zoomPercent: 100, wrapLines: true },
    });
    expect(stripped.notepad.documents[0]?.content).toBe("");
    expect(stripped.chatHttp?.documents[0]?.content).toBe("");
    expect(stripped.workspaces[0]?.snapshot.documents[0]?.contentKind).toBe("image");
  });

  it("strips ephemeral view tabs and reseats a view-tab selection", () => {
    const stripped = stripWindowSnapshotForSession({
      activeContextId: "notepad",
      notepad: {
        documents: [baseDocument()],
        session: {
          // Settings view tab is selected; a file tab also exists.
          editorLayout: createSinglePaneLayout(
            [
              createFileTab("tab-file", "doc-1"),
              createViewTab("tab-settings", "settings"),
              createViewTab("tab-themes", "themes"),
            ],
            "tab-settings",
          ),
          lastActiveWindowId: "main",
          windowBounds: null,
        },
      },
      workspaces: [],
      editorPreferences: { zoomPercent: 100, wrapLines: true },
    });

    const tabs = getSessionTabs(stripped.notepad.session);
    expect(tabs.every((tab) => tab.kind !== "view")).toBe(true);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.kind).toBe("file");
    // Selection fell back to the remaining file tab.
    expect(getSessionSelectedTabId(stripped.notepad.session)).toBe("tab-file");
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

  it("does not refresh large_pending documents", () => {
    expect(
      needsDocumentRefreshFromDisk(
        baseDocument({ filePath: "/tmp/big.txt", contentKind: "large_pending" }),
      ),
    ).toBe(false);
  });
});

describe("applyLargeFileConfirmGateOnRestore", () => {
  beforeEach(() => {
    statDiskFingerprintMock.mockReset();
  });

  it("forces large_pending for persisted text over the limit", async () => {
    const limit = 1024 * 1024;
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 2, sizeBytes: limit + 100 });
    const doc = baseDocument({
      filePath: "/tmp/big.txt",
      content: "loaded before relaunch",
      savedContent: "loaded before relaunch",
      contentKind: "text",
    });

    const result = await applyLargeFileConfirmGateOnRestore(doc, limit, () => false);

    expect(result).toMatchObject({
      content: "",
      savedContent: "",
      isDirty: false,
      contentKind: "large_pending",
      diskFingerprint: { mtimeMs: 2, sizeBytes: limit + 100 },
    });
  });

  it("leaves documents within the limit unchanged", async () => {
    const limit = 1024 * 1024;
    statDiskFingerprintMock.mockResolvedValue({ mtimeMs: 2, sizeBytes: 512 });
    const doc = baseDocument({
      filePath: "/tmp/small.txt",
      content: "still here",
      contentKind: "text",
    });

    const result = await applyLargeFileConfirmGateOnRestore(doc, limit, () => false);
    expect(result).toBe(doc);
  });
});
