import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  createEditorDocumentSessionCache,
  sessionKeyId,
  type EditorSessionKey,
} from "./editorDocumentSessionCache";
import type { ContextId } from "../domain/contracts";

function makeState(doc: string): EditorState {
  return EditorState.create({ doc });
}

/** Build a session key with a default context id. The cache is now namespaced
 *  by context, but these tests exercise pane/document behavior within one
 *  context, so a fixed default keeps them terse. */
function key(paneId: string, documentId: string, contextId: ContextId = "notepad"): EditorSessionKey {
  return { contextId, paneId, documentId };
}

describe("editorDocumentSessionCache", () => {
  it("saves and takes session state by pane+document key", () => {
    const cache = createEditorDocumentSessionCache();
    const state = makeState("doc-a");
    const k = key("pane-1", "a");

    cache.save(k, state);
    expect(cache.has(k)).toBe(true);
    expect(cache.size()).toBe(1);

    const taken = cache.take(k);
    expect(taken?.doc.toString()).toBe("doc-a");
    expect(cache.has(k)).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it("keeps independent sessions for the same document in different panes", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save(key("pane-1", "shared"), makeState("from-pane-1"));
    cache.save(key("pane-2", "shared"), makeState("from-pane-2"));

    expect(cache.take(key("pane-1", "shared"))?.doc.toString()).toBe("from-pane-1");
    expect(cache.take(key("pane-2", "shared"))?.doc.toString()).toBe("from-pane-2");
  });

  it("evicts least-recently-used entries when over maxEntries", () => {
    const cache = createEditorDocumentSessionCache({ maxEntries: 2 });
    cache.save(key("p", "1"), makeState("one"));
    cache.save(key("p", "2"), makeState("two"));
    // Touch doc 1 so doc 2 becomes older relative to a new insert after peek.
    cache.peek(key("p", "1"));
    cache.save(key("p", "3"), makeState("three"));

    expect(cache.size()).toBe(2);
    expect(cache.has(key("p", "2"))).toBe(false);
    expect(cache.has(key("p", "1"))).toBe(true);
    expect(cache.has(key("p", "3"))).toBe(true);
  });

  it("invalidateDocument drops all pane sessions for that document", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save(key("p1", "a"), makeState("a1"));
    cache.save(key("p2", "a"), makeState("a2"));
    cache.save(key("p1", "b"), makeState("b"));

    cache.invalidateDocument("a");

    expect(cache.has(key("p1", "a"))).toBe(false);
    expect(cache.has(key("p2", "a"))).toBe(false);
    expect(cache.has(key("p1", "b"))).toBe(true);
  });

  it("invalidatePane drops only that pane's sessions", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save(key("p1", "a"), makeState("a"));
    cache.save(key("p2", "a"), makeState("a"));

    cache.invalidatePane("p1");

    expect(cache.has(key("p1", "a"))).toBe(false);
    expect(cache.has(key("p2", "a"))).toBe(true);
  });

  it("retainDocuments keeps only open document ids", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save(key("p", "keep"), makeState("keep"));
    cache.save(key("p", "drop"), makeState("drop"));

    cache.retainDocuments(new Set(["keep"]));

    expect(cache.has(key("p", "keep"))).toBe(true);
    expect(cache.has(key("p", "drop"))).toBe(false);
  });

  it("clear disposes the cache and rejects further saves", () => {
    const cache = createEditorDocumentSessionCache();
    cache.save(key("p", "a"), makeState("a"));
    cache.clear();
    expect(cache.size()).toBe(0);
    cache.save(key("p", "b"), makeState("b"));
    expect(cache.size()).toBe(0);
  });

  it("sessionKeyId is stable for the same context+pane+document", () => {
    expect(sessionKeyId(key("p", "d"))).toBe(sessionKeyId(key("p", "d")));
    expect(sessionKeyId(key("p", "d"))).not.toBe(sessionKeyId(key("q", "d")));
  });

  it("namespaces sessions by context id (cross-context collision guard)", () => {
    // Two contexts with the same pane/document ids must keep independent states
    // so switching between mounted contexts cannot resurrect the wrong state.
    const cache = createEditorDocumentSessionCache();
    cache.save(key("pane-1", "doc-1", "ws-1"), makeState("from-workspace-a"));
    cache.save(key("pane-1", "doc-1", "ws-2"), makeState("from-workspace-b"));

    expect(cache.take(key("pane-1", "doc-1", "ws-1"))?.doc.toString()).toBe(
      "from-workspace-a",
    );
    expect(cache.take(key("pane-1", "doc-1", "ws-2"))?.doc.toString()).toBe(
      "from-workspace-b",
    );
    // Different context + same pane/document produces a different key id.
    expect(sessionKeyId(key("p", "d", "ws-1"))).not.toBe(
      sessionKeyId(key("p", "d", "ws-2")),
    );
  });
});
