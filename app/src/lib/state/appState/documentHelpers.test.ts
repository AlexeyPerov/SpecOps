import { describe, expect, it } from "vitest";
import type { DocumentState } from "../../domain/contracts";
import { buildDocument, documentWithOpenedFilePayload } from "./documentHelpers";

function baseDoc(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    filePath: "/tmp/keenetic-dns.png",
    title: "keenetic-dns.png",
    content: "garbage-from-old-read",
    savedContent: "garbage-from-old-read",
    isDirty: false,
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

describe("documentWithOpenedFilePayload", () => {
  it("upgrades stale text documents to image preview", () => {
    const next = documentWithOpenedFilePayload(
      baseDoc(),
      "/tmp/keenetic-dns.png",
      "",
      "image",
    );
    expect(next.contentKind).toBe("image");
    expect(next.content).toBe("");
    expect(next.savedContent).toBe("");
    expect(next.isDirty).toBe(false);
  });

  it("leaves matching text documents unchanged", () => {
    const doc = baseDoc({
      filePath: "/tmp/readme.md",
      title: "readme.md",
      content: "hello",
      savedContent: "hello",
      contentKind: "text",
      language: "markdown",
    });
    const next = documentWithOpenedFilePayload(doc, "/tmp/readme.md", "hello", "text");
    expect(next).toBe(doc);
  });

  it("clears stale buffers when kind is already image", () => {
    const doc = baseDoc({
      contentKind: "image",
      content: "stale-session-bytes",
      savedContent: "stale-session-bytes",
      isDirty: true,
    });
    const next = documentWithOpenedFilePayload(doc, "/tmp/keenetic-dns.png", "", "image");
    expect(next.content).toBe("");
    expect(next.isDirty).toBe(false);
  });

  it("preserves dirty text edits when kind stays text", () => {
    const doc = baseDoc({
      filePath: "/tmp/notes.txt",
      content: "edited",
      savedContent: "original",
      isDirty: true,
    });
    const next = documentWithOpenedFilePayload(doc, "/tmp/notes.txt", "from-disk", "text");
    expect(next).toBe(doc);
  });
});

describe("buildDocument", () => {
  it("seeds markdown files with the configured default view mode", () => {
    const doc = buildDocument(
      { id: "doc-1", filePath: "/tmp/readme.md" },
      "# hi",
      "readme.md",
      "text",
      "preview",
    );
    expect(doc.language).toBe("markdown");
    expect(doc.markdownViewMode).toBe("preview");
  });

  it("defaults markdown files to edit when no default is given", () => {
    const doc = buildDocument({ id: "doc-1", filePath: "/tmp/readme.md" }, "# hi", "readme.md");
    expect(doc.markdownViewMode).toBe("edit");
  });

  it("ignores the default view mode for non-markdown files", () => {
    const doc = buildDocument(
      { id: "doc-1", filePath: "/tmp/notes.txt" },
      "hi",
      "notes.txt",
      "text",
      "preview",
    );
    expect(doc.language).toBe("plaintext");
    expect(doc.markdownViewMode).toBe("edit");
  });
});
