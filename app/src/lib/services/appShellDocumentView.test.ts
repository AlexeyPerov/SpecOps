import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DocumentState } from "../domain/contracts";
import {
  deriveAppShellDocumentView,
  invalidateDocumentMarkdownHtml,
  isTextEditorDocumentState,
} from "./appShellDocumentView";
import * as markdownImageSrc from "./markdownImageSrc";

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

describe("isTextEditorDocumentState", () => {
  it("accepts text documents and rejects image/binary/large/undefined", () => {
    expect(isTextEditorDocumentState(textDocument())).toBe(true);
    expect(
      isTextEditorDocumentState(textDocument({ contentKind: "image" })),
    ).toBe(false);
    expect(
      isTextEditorDocumentState(textDocument({ contentKind: "binary" })),
    ).toBe(false);
    expect(
      isTextEditorDocumentState(textDocument({ contentKind: "large_pending" })),
    ).toBe(false);
    expect(isTextEditorDocumentState(undefined)).toBe(false);
  });
});

describe("deriveAppShellDocumentView — markdownHtml memoization", () => {
  beforeEach(() => {
    invalidateDocumentMarkdownHtml();
  });

  it("reuses rendered html for the same content string across document object identity", () => {
    const spy = vi.spyOn(markdownImageSrc, "renderDocumentMarkdown");
    const content = "# Cached heading";
    const first = textDocument({ content, savedContent: content });
    const second = { ...first, scrollTop: 40 };

    const a = deriveAppShellDocumentView(first, { renderMarkdownHtml: true });
    const b = deriveAppShellDocumentView(second, { renderMarkdownHtml: true });

    expect(a.markdownHtml).toBe(b.markdownHtml);
    expect(a.markdownHtml).toContain("Cached heading");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("re-renders when content changes", () => {
    const spy = vi.spyOn(markdownImageSrc, "renderDocumentMarkdown");
    const first = textDocument({ content: "# One", savedContent: "# One" });
    const second = textDocument({ content: "# Two", savedContent: "# Two" });

    deriveAppShellDocumentView(first, { renderMarkdownHtml: true });
    deriveAppShellDocumentView(second, { renderMarkdownHtml: true });

    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("re-renders when filePath changes for the same content (image base path)", () => {
    const spy = vi.spyOn(markdownImageSrc, "renderDocumentMarkdown");
    const content = "# Same body";
    const first = textDocument({ content, savedContent: content, filePath: "/a/readme.md" });
    const second = textDocument({ content, savedContent: content, filePath: "/b/readme.md" });

    deriveAppShellDocumentView(first, { renderMarkdownHtml: true });
    deriveAppShellDocumentView(second, { renderMarkdownHtml: true });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, content, "/a/readme.md");
    expect(spy).toHaveBeenNthCalledWith(2, content, "/b/readme.md");
    spy.mockRestore();
  });
});
