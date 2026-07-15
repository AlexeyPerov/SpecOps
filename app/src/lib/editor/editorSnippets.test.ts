import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CompletionContext,
  hasNextSnippetField,
  nextSnippetField,
} from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import type { ResolvedMarkdownSnippet } from "../domain/snippets";
import {
  createSnippetCompletionSource,
  insertMarkdownSnippet,
  snippetExtension,
} from "./editorSnippets";

function makeSnippet(
  overrides: Partial<ResolvedMarkdownSnippet> = {},
): ResolvedMarkdownSnippet {
  return {
    id: "user-test",
    name: "Test",
    description: "desc",
    trigger: "tst",
    body: "Hello ${1:World}${0}",
    scope: "markdown",
    source: "user",
    enabled: true,
    ...overrides,
  };
}

function mount(doc = "", withHistory = false): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        ...(withHistory ? [history()] : []),
        snippetExtension({ enabled: true }),
      ],
    }),
  });
}

describe("insertMarkdownSnippet", () => {
  it("inserts body, selects the first tab stop, and advances with Tab", () => {
    const view = mount("");
    const result = insertMarkdownSnippet(view, makeSnippet());
    expect(result.ok).toBe(true);
    expect(view.state.doc.toString()).toBe("Hello World");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "World",
    );
    expect(hasNextSnippetField(view.state)).toBe(true);
    expect(nextSnippetField(view)).toBe(true);
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
    view.destroy();
  });

  it("undoes the whole insertion in one step", () => {
    const view = mount("prefix ", true);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    insertMarkdownSnippet(view, makeSnippet({ body: "INS${0}" }));
    expect(view.state.doc.toString()).toBe("prefix INS");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("prefix ");
    view.destroy();
  });

  it("wraps the main selection via ${SELECTION}", () => {
    const view = mount("abc");
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    const result = insertMarkdownSnippet(
      view,
      makeSnippet({ body: "> ${SELECTION}${0}" }),
    );
    expect(result.ok).toBe(true);
    expect(view.state.doc.toString()).toBe("> abc");
    view.destroy();
  });

  it("adapts indentation for multiline templates", () => {
    const view = mount("  base");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    insertMarkdownSnippet(view, makeSnippet({ body: "\n\tline${0}" }));
    expect(view.state.doc.toString().startsWith("  base")).toBe(true);
    expect(view.state.doc.toString()).toContain("line");
    view.destroy();
  });
});

describe("createSnippetCompletionSource", () => {
  it("offers matching triggers for a typed prefix", () => {
    const source = createSnippetCompletionSource([
      makeSnippet({ trigger: "fm", name: "Front matter" }),
      makeSnippet({ id: "user-2", trigger: "req", name: "Requirements" }),
    ]);
    const state = EditorState.create({ doc: "f" });
    const context = new CompletionContext(state, 1, true);
    const result = source(context);
    expect(result).not.toBeNull();
    if (!result || result instanceof Promise) {
      throw new Error("expected sync completion result");
    }
    expect(result.options.some((option) => option.label === "fm")).toBe(true);
    expect(result.options.some((option) => option.label === "req")).toBe(false);
  });
});
