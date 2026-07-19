import { describe, expect, it } from "vitest";
import type { DocumentState } from "../domain/contracts";
import { createFileTab, createSessionTab, createViewTab } from "../domain/contracts";
import { isTabVisibleInStrip } from "./implicitDraftTab";
import { buildDocumentByIdMap, getDocumentByIdMap, tabDocumentFromMap } from "./tabDocumentLookup";

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

describe("tabDocumentLookup", () => {
  it("builds an id map and resolves file tabs in O(1)", () => {
    const documents = [
      doc({ id: "doc-1", title: "a.txt", filePath: "/tmp/a.txt" }),
      doc({ id: "doc-2", title: "b.txt", filePath: "/tmp/b.txt", fileMissing: true }),
      doc({ id: "doc-3", title: "c.txt", filePath: null }),
    ];
    const byId = buildDocumentByIdMap(documents);

    expect(byId.size).toBe(3);
    expect(tabDocumentFromMap(createFileTab("t1", "doc-2"), byId)?.title).toBe("b.txt");
    expect(tabDocumentFromMap(createFileTab("t1", "doc-2"), byId)?.fileMissing).toBe(true);
    expect(tabDocumentFromMap(createFileTab("t-missing", "doc-x"), byId)).toBeUndefined();
  });

  it("returns undefined for session and view tabs", () => {
    const byId = buildDocumentByIdMap([doc()]);
    expect(tabDocumentFromMap(createSessionTab("s1", "agent-a"), byId)).toBeUndefined();
    expect(tabDocumentFromMap(createViewTab("v1", "settings"), byId)).toBeUndefined();
  });

  it("supports strip visibility / title / missing markers without linear find", () => {
    const documents = [
      doc({ id: "visible", title: "notes.md", content: "x", savedContent: "x" }),
      doc({
        id: "hidden-empty",
        title: "Untitled",
        content: "",
        savedContent: "",
        filePath: null,
      }),
      doc({ id: "missing", title: "gone.txt", fileMissing: true }),
    ];
    const byId = buildDocumentByIdMap(documents);
    const tabs = [
      createFileTab("t-visible", "visible"),
      createFileTab("t-hidden", "hidden-empty", false, true),
      createFileTab("t-missing", "missing"),
      createSessionTab("t-session", "agent-a"),
    ];

    const visible = tabs.filter((tab) => isTabVisibleInStrip(tab, tabDocumentFromMap(tab, byId)));
    expect(visible.map((tab) => tab.id)).toEqual(["t-visible", "t-missing", "t-session"]);

    const labels = tabs.map((tab) => {
      const tabDoc = tabDocumentFromMap(tab, byId);
      if (!tabDoc) {
        return tab.kind === "session" ? "session" : "view";
      }
      return tabDoc.fileMissing ? `${tabDoc.title} (missing)` : tabDoc.title;
    });
    expect(labels).toEqual(["notes.md", "Untitled", "gone.txt (missing)", "session"]);
  });

  it("getDocumentByIdMap reuses the same Map for the same documents array", () => {
    const documents = [doc({ id: "doc-1" }), doc({ id: "doc-2" })];
    expect(getDocumentByIdMap(documents)).toBe(getDocumentByIdMap(documents));
  });

  it("map lookup stays correct for large tab counts where find would scan repeatedly", () => {
    const count = 200;
    const documents = Array.from({ length: count }, (_, i) =>
      doc({ id: `doc-${i}`, title: `f-${i}.txt`, filePath: `/tmp/f-${i}.txt` }),
    );
    const tabs = documents.map((d, i) => createFileTab(`tab-${i}`, d.id));
    const byId = buildDocumentByIdMap(documents);

    // Touch every tab twice (visibility + label) — the hot path TabBar uses.
    for (const tab of tabs) {
      const first = tabDocumentFromMap(tab, byId);
      const second = tabDocumentFromMap(tab, byId);
      expect(first?.id).toBe(tab.documentId);
      expect(second).toBe(first);
    }
    expect(tabDocumentFromMap(tabs[count - 1]!, byId)?.title).toBe(`f-${count - 1}.txt`);
  });
});
