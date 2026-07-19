import { describe, expect, it } from "vitest";
import type { DocumentState } from "../domain/contracts";
import { createFileTab, createSessionTab } from "../domain/contracts";
import {
  filterVisibleTabs,
  getDocumentByIdMap,
  getSessionTitleById,
} from "./tabDocumentLookup";

function doc(overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    id: "doc-1",
    title: "a.txt",
    filePath: "/tmp/ws/a.txt",
    content: "hello",
    savedContent: "hello",
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

describe("getDocumentByIdMap", () => {
  it("reuses the same Map instance for the same documents array", () => {
    const documents = [doc({ id: "doc-1" }), doc({ id: "doc-2" })];
    const first = getDocumentByIdMap(documents);
    const second = getDocumentByIdMap(documents);
    expect(second).toBe(first);
  });

  it("builds a new Map when the documents array identity changes", () => {
    const documentsA = [doc({ id: "doc-1" })];
    const documentsB = [doc({ id: "doc-1" })];
    expect(getDocumentByIdMap(documentsB)).not.toBe(getDocumentByIdMap(documentsA));
  });
});

describe("filterVisibleTabs", () => {
  it("reuses the filtered array when openTabs and documentById are unchanged", () => {
    const documents = [
      doc({ id: "visible", content: "x", savedContent: "x" }),
      doc({ id: "hidden-empty", content: "", savedContent: "", filePath: null }),
    ];
    const documentById = getDocumentByIdMap(documents);
    const openTabs = [
      createFileTab("t-visible", "visible"),
      createFileTab("t-hidden", "hidden-empty", false, true),
      createSessionTab("t-session", "agent-a"),
    ];

    const first = filterVisibleTabs(openTabs, documentById);
    const second = filterVisibleTabs(openTabs, documentById);
    expect(second).toBe(first);
    expect(first.map((tab) => tab.id)).toEqual(["t-visible", "t-session"]);
  });

  it("recomputes when documentById identity changes", () => {
    const openTabs = [createFileTab("t-hidden", "hidden-empty", false, true)];
    const emptyMap = getDocumentByIdMap([
      doc({ id: "hidden-empty", content: "", savedContent: "", filePath: null }),
    ]);
    const filledMap = getDocumentByIdMap([
      doc({ id: "hidden-empty", content: "x", savedContent: "x", filePath: null }),
    ]);

    const hidden = filterVisibleTabs(openTabs, emptyMap);
    const visible = filterVisibleTabs(openTabs, filledMap);
    expect(hidden).toHaveLength(0);
    expect(visible).toHaveLength(1);
    expect(visible).not.toBe(hidden);
  });
});

describe("getSessionTitleById", () => {
  it("reuses the same Map instance for the same session index array", () => {
    const index = [
      { id: "s1", title: "First" },
      { id: "s2", title: "Second" },
    ];
    const first = getSessionTitleById(index);
    const second = getSessionTitleById(index);
    expect(second).toBe(first);
    expect(first.get("s2")).toBe("Second");
  });

  it("builds a new Map when the session index array identity changes", () => {
    const indexA = [{ id: "s1", title: "First" }];
    const indexB = [{ id: "s1", title: "First" }];
    expect(getSessionTitleById(indexB)).not.toBe(getSessionTitleById(indexA));
  });
});
