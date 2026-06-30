import { describe, expect, it } from "vitest";
import type { DocumentState } from "../domain/contracts";
import { deriveAppShellDocumentView } from "./appShellDocumentView";

function textDocument(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    filePath: "/tmp/readme.md",
    title: "readme.md",
    content: "# Hello",
    savedContent: "# Hello",
    isDirty: false,
    contentKind: "text",
    language: "markdown",
    encoding: "utf-8",
    lineEnding: "lf",
    diskFingerprint: { mtimeMs: 1, sizeBytes: 7 },
    dismissedFingerprint: null,
    fileMissing: false,
    scrollTop: 0,
    markdownViewMode: "edit",
    ...overrides,
  };
}

describe("deriveAppShellDocumentView — undefined input (non-file active tab)", () => {
  // Phase 4: with the split, the active pane can legitimately show a session /
  // settings / themes tab or be empty, in which case there is no active
  // document. The view must degrade to all-false flags + an empty status path
  // (no crash, no spurious editor surface).
  it("returns all-false flags and an empty status path for undefined", () => {
    const view = deriveAppShellDocumentView(undefined);
    expect(view).toEqual({
      isImageDocument: false,
      isBinaryDocument: false,
      isLargePendingDocument: false,
      isTextEditorDocument: false,
      previewFileSizeBytes: 0,
      isMarkdownDocument: false,
      markdownHtml: "",
      statusPath: "Untitled",
      activeDocumentPath: null,
    });
  });
});

describe("deriveAppShellDocumentView — text/markdown document", () => {
  it("flags a markdown document and skips preview html unless requested", () => {
    const view = deriveAppShellDocumentView(textDocument());
    expect(view.isTextEditorDocument).toBe(true);
    expect(view.isMarkdownDocument).toBe(true);
    expect(view.isImageDocument).toBe(false);
    expect(view.markdownHtml).toBe("");
    expect(view.statusPath).toBe("tmp/readme.md");
    expect(view.activeDocumentPath).toBe("/tmp/readme.md");
  });

  it("renders preview html when explicitly requested", () => {
    const view = deriveAppShellDocumentView(textDocument(), { renderMarkdownHtml: true });
    expect(view.markdownHtml).toContain("Hello");
  });

  it("reports the on-disk size from the fingerprint", () => {
    const view = deriveAppShellDocumentView(
      textDocument({ diskFingerprint: { mtimeMs: 2, sizeBytes: 4096 } }),
    );
    expect(view.previewFileSizeBytes).toBe(4096);
  });
});

describe("deriveAppShellDocumentView — non-text kinds", () => {
  it("flags an image document and suppresses the editor/markdown flags", () => {
    const view = deriveAppShellDocumentView(
      textDocument({ contentKind: "image", filePath: "/tmp/icon.png", title: "icon.png" }),
    );
    expect(view.isImageDocument).toBe(true);
    expect(view.isTextEditorDocument).toBe(false);
    expect(view.isMarkdownDocument).toBe(false);
    expect(view.markdownHtml).toBe("");
  });

  it("flags a binary document", () => {
    const view = deriveAppShellDocumentView(
      textDocument({ contentKind: "binary", filePath: "/tmp/blob.bin", title: "blob.bin" }),
    );
    expect(view.isBinaryDocument).toBe(true);
    expect(view.isTextEditorDocument).toBe(false);
  });

  it("flags a large-pending document", () => {
    const view = deriveAppShellDocumentView(
      textDocument({ contentKind: "large_pending", filePath: "/tmp/huge.log", title: "huge.log" }),
    );
    expect(view.isLargePendingDocument).toBe(true);
    expect(view.isTextEditorDocument).toBe(false);
  });
});
