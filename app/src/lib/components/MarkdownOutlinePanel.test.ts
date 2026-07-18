import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type { EditorHost, EditorHostIdentity, MarkdownHeadingSnapshot } from "../types/editor";
import MarkdownOutlinePanel from "./MarkdownOutlinePanel.svelte";
import { mountComponent } from "./_testComponentMount";

function heading(text: string, key = text): MarkdownHeadingSnapshot {
  return { key, level: 1, text, from: 0, to: text.length, line: 1 };
}

function makeHost(
  identity: EditorHostIdentity,
  headings: MarkdownHeadingSnapshot[],
): EditorHost {
  return {
    identity,
    actions: {
      history: { undo: () => ({ ok: true }), redo: () => ({ ok: true }) },
      selection: {
        indent: () => ({ ok: true }),
        outdent: () => ({ ok: true }),
        selectNextOccurrence: () => ({ ok: true }),
        selectAllOccurrences: () => ({ ok: true }),
        skipOccurrence: () => ({ ok: true }),
        undoOccurrence: () => ({ ok: true }),
      },
      lines: {
        moveLineUp: () => ({ ok: true }),
        moveLineDown: () => ({ ok: true }),
        duplicateLine: () => ({ ok: true }),
        joinLines: () => ({ ok: true }),
      },
      navigation: {
        goToLine: () => ({ ok: true }),
        jumpToHeading: () => ({ ok: true }),
      },
      search: {
        findNext: () => ({ ok: true }),
        findPrevious: () => ({ ok: true }),
        replaceCurrent: () => ({ ok: true }),
        replaceAndFindNext: () => ({ ok: true }),
        replaceAll: () => ({ ok: true, value: 0 }),
        setSearchQuery: () => ({ ok: true }),
      },
      view: { setWrap: () => ({ ok: true }), setZoom: () => ({ ok: true }) },
      folding: {
        toggle: () => ({ ok: true }),
        fold: () => ({ ok: true }),
        unfold: () => ({ ok: true }),
        foldAll: () => ({ ok: true }),
        unfoldAll: () => ({ ok: true }),
      },
      completion: { trigger: () => ({ ok: true }) },
      snippets: { insert: () => ({ ok: true }) },
      bookmarks: {
        toggle: () => ({ ok: true }),
        next: () => ({ ok: true }),
        previous: () => ({ ok: true }),
        clearAll: () => ({ ok: true }),
      },
    },
    queries: {
      history: {
        canUndo: () => ({ ok: true, value: false }),
        canRedo: () => ({ ok: true, value: false }),
      },
      selection: {
        getSelection: () => ({
          ok: true,
          value: { from: 0, to: 0, head: 0, empty: true },
        }),
      },
      document: { getDocumentContent: () => ({ ok: true, value: "" }) },
      search: {
        getMatchInfo: () => ({ ok: true, value: { total: 0, current: 0 } }),
      },
      markdown: {
        getHeadings: () => ({ ok: true, value: headings }),
        getActiveHeadingKey: () => ({ ok: true, value: null }),
        isHeadingFolded: () => ({ ok: true, value: false }),
      },
      bookmarks: { list: () => ({ ok: true, value: [] }) },
    },
    capability: () => ({ state: "available" }),
    focus: vi.fn(),
  };
}

describe("MarkdownOutlinePanel", () => {
  it("renders headings from the matching active host", async () => {
    const editorHost = makeHost(
      { contextId: "notepad", paneId: "pane-a", documentId: "doc-1", generation: 1 },
      [heading("Intro")],
    );
    const { host } = mountComponent(MarkdownOutlinePanel, {
      getHost: () => editorHost,
      documentId: "doc-1",
      paneId: "pane-a",
      onJump: () => {},
      onClose: () => {},
    });
    await tick();
    expect(host.textContent).toContain("Intro");
  });

  it("does not publish headings when host document id mismatches the pane selection", async () => {
    const staleHost = makeHost(
      { contextId: "notepad", paneId: "pane-a", documentId: "doc-1", generation: 1 },
      [heading("Stale")],
    );
    const { host } = mountComponent(MarkdownOutlinePanel, {
      getHost: () => staleHost,
      documentId: "doc-2",
      paneId: "pane-a",
      onJump: () => {},
      onClose: () => {},
    });
    await tick();
    expect(host.textContent).not.toContain("Stale");
    expect(host.textContent).toContain("No headings in this document.");
  });
});
