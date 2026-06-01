import { describe, expect, it } from "vitest";
import type { DocumentState } from "../domain/contracts";
import { DEFAULT_UNTITLED_TITLE } from "./untitledTitle";
import { isEmptyUnsavedDocument, isUnsavedDocument } from "./untitledDocument";

function doc(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    filePath: null,
    title: DEFAULT_UNTITLED_TITLE,
    content: "",
    savedContent: "",
    isDirty: false,
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

describe("untitledDocument", () => {
  it("isUnsavedDocument checks filePath only", () => {
    expect(isUnsavedDocument(doc())).toBe(true);
    expect(isUnsavedDocument(doc({ filePath: "/tmp/a.txt", title: "a.txt" }))).toBe(false);
  });

  it("isEmptyUnsavedDocument ignores title", () => {
    expect(isEmptyUnsavedDocument(doc())).toBe(true);
    expect(isEmptyUnsavedDocument(doc({ title: "Draft heading", content: "Draft heading" }))).toBe(
      false,
    );
    expect(isEmptyUnsavedDocument(doc({ title: "Stale Untitled", content: "hello" }))).toBe(false);
    expect(
      isEmptyUnsavedDocument(doc({ filePath: "/tmp/a.txt", title: "a.txt", content: "" })),
    ).toBe(false);
  });
});
