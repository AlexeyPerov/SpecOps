import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  createEditorDocumentSessionCache,
  sessionKeyId,
} from "./editorDocumentSessionCache";

function makeState(doc: string): EditorState {
  return EditorState.create({ doc });
}

describe("editorDocumentSessionCache", () => {
  it("saves and takes session state by pane+document key", () => {
    const cache = createEditorDocumentSessionCache();
    const state = makeState("doc-a");
    const key = { paneId: "pane-1", documentId: "a" };

    cache.save(key, state);
    expect(cache.has(key)).toBe(true);
    expect(cache.size()).toBe(1);

    const taken = cache.take(key);
    expect(taken?.doc.toString()).toBe("doc-a");
    expect(cache.has(key)).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it("keeps independent sessions for the same document in different panes", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save({ paneId: "pane-1", documentId: "shared" }, makeState("from-pane-1"));
    cache.save({ paneId: "pane-2", documentId: "shared" }, makeState("from-pane-2"));

    expect(cache.take({ paneId: "pane-1", documentId: "shared" })?.doc.toString()).toBe(
      "from-pane-1",
    );
    expect(cache.take({ paneId: "pane-2", documentId: "shared" })?.doc.toString()).toBe(
      "from-pane-2",
    );
  });

  it("evicts least-recently-used entries when over maxEntries", () => {
    const cache = createEditorDocumentSessionCache({ maxEntries: 2 });
    cache.save({ paneId: "p", documentId: "1" }, makeState("one"));
    cache.save({ paneId: "p", documentId: "2" }, makeState("two"));
    // Touch doc 1 so doc 2 becomes older relative to a new insert after peek.
    cache.peek({ paneId: "p", documentId: "1" });
    cache.save({ paneId: "p", documentId: "3" }, makeState("three"));

    expect(cache.size()).toBe(2);
    expect(cache.has({ paneId: "p", documentId: "2" })).toBe(false);
    expect(cache.has({ paneId: "p", documentId: "1" })).toBe(true);
    expect(cache.has({ paneId: "p", documentId: "3" })).toBe(true);
  });

  it("invalidateDocument drops all pane sessions for that document", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save({ paneId: "p1", documentId: "a" }, makeState("a1"));
    cache.save({ paneId: "p2", documentId: "a" }, makeState("a2"));
    cache.save({ paneId: "p1", documentId: "b" }, makeState("b"));

    cache.invalidateDocument("a");

    expect(cache.has({ paneId: "p1", documentId: "a" })).toBe(false);
    expect(cache.has({ paneId: "p2", documentId: "a" })).toBe(false);
    expect(cache.has({ paneId: "p1", documentId: "b" })).toBe(true);
  });

  it("invalidatePane drops only that pane's sessions", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save({ paneId: "p1", documentId: "a" }, makeState("a"));
    cache.save({ paneId: "p2", documentId: "a" }, makeState("a"));

    cache.invalidatePane("p1");

    expect(cache.has({ paneId: "p1", documentId: "a" })).toBe(false);
    expect(cache.has({ paneId: "p2", documentId: "a" })).toBe(true);
  });

  it("retainDocuments keeps only open document ids", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save({ paneId: "p", documentId: "keep" }, makeState("keep"));
    cache.save({ paneId: "p", documentId: "drop" }, makeState("drop"));

    cache.retainDocuments(new Set(["keep"]));

    expect(cache.has({ paneId: "p", documentId: "keep" })).toBe(true);
    expect(cache.has({ paneId: "p", documentId: "drop" })).toBe(false);
  });

  it("clear disposes the cache and rejects further saves", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save({ paneId: "p", documentId: "a" }, makeState("a"));
    cache.clear();
    expect(cache.size()).toBe(0);
    cache.save({ paneId: "p", documentId: "b" }, makeState("b"));
    expect(cache.size()).toBe(0);
  });

  it("sessionKeyId is stable for the same pane+document", () => {
    expect(sessionKeyId({ paneId: "p", documentId: "d" })).toBe(
      sessionKeyId({ paneId: "p", documentId: "d" }),
    );
    expect(sessionKeyId({ paneId: "p", documentId: "d" })).not.toBe(
      sessionKeyId({ paneId: "q", documentId: "d" }),
    );
  });
});
