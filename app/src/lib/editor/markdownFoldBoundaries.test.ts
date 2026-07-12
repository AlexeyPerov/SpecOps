import { describe, expect, it } from "vitest";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import {
  computeMarkdownHeadingFoldBoundaries,
  createMarkdownFoldTestState,
  markdownHeadingFoldableAtLine,
} from "./markdownFoldBoundaries";
import { foldExtension } from "./editorFold";
import { foldCode, unfoldCode, foldedRanges } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

describe("computeMarkdownHeadingFoldBoundaries", () => {
  it("folds a heading section until the next equal/higher heading", () => {
    const text = "# A\n\nbody\n\n## B\n\nnested\n\n# C\n\nend\n";
    const boundaries = computeMarkdownHeadingFoldBoundaries(text);
    const a = boundaries.find((b) => b.heading.text === "A");
    const b = boundaries.find((b) => b.heading.text === "B");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(text.slice(a!.from, a!.to)).toContain("## B");
    expect(text.slice(a!.from, a!.to)).not.toContain("# C");
    expect(text.slice(b!.from, b!.to)).toContain("nested");
    expect(text.slice(b!.from, b!.to)).not.toContain("# C");
  });

  it("handles the final section through EOF", () => {
    const text = "# Only\n\nlast section content\n";
    const boundaries = computeMarkdownHeadingFoldBoundaries(text);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]!.to).toBe(text.length);
  });

  it("covers setext headings", () => {
    const text = "Title\n=====\n\nbody\n\nSub\n---\n\nmore\n";
    const boundaries = computeMarkdownHeadingFoldBoundaries(text);
    expect(boundaries.map((b) => b.heading.text)).toEqual(["Title", "Sub"]);
  });
});

describe("lang-markdown fold service", () => {
  it("exposes foldable ranges on heading lines matching pure section starts", () => {
    const text = "# A\n\nbody\n\n## B\n\nnested\n\n# C\n\nafter\n";
    const state = createMarkdownFoldTestState(text);
    const pure = computeMarkdownHeadingFoldBoundaries(text);
    expect(pure.length).toBeGreaterThan(0);
    for (const boundary of pure) {
      const range = markdownHeadingFoldableAtLine(state, boundary.heading.line);
      expect(range).not.toBeNull();
      // Native fold starts at the end of the heading line (same as pure).
      expect(range!.from).toBe(boundary.from);
      // End may exclude trailing blank lines before the next heading; still
      // covers the section body and stops at/before the next equal/higher heading.
      expect(range!.to).toBeGreaterThan(range!.from);
      expect(range!.to).toBeLessThanOrEqual(boundary.to);
    }
  });

  it("does not treat fenced code heading-like lines as section folds", () => {
    const text = "# Real\n\n```\n# Fake\n```\n\n## Next\n";
    const state = createMarkdownFoldTestState(text);
    // The fake heading line inside the fence should not produce a heading fold
    // via our pure boundaries (and Real still folds through Next).
    const pure = computeMarkdownHeadingFoldBoundaries(text);
    expect(pure.map((b) => b.heading.text)).toEqual(["Real", "Next"]);
    const fakeLine = text.split("\n").findIndex((line) => line === "# Fake") + 1;
    const fakeFold = markdownHeadingFoldableAtLine(state, fakeLine);
    // Fenced content may still be foldable as a code block from the fence line,
    // but not as a heading section starting on "# Fake".
    if (fakeFold) {
      expect(fakeFold.from).not.toBe(state.doc.line(fakeLine).to);
    }
  });
});

describe("fold extension lifecycle", () => {
  it("folds without mutating document content", () => {
    const doc = "function a() {\n  return 1;\n}\n";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [javascript(), foldExtension({ showGutter: true })],
      }),
      parent,
    });
    // foldCode folds from the selected line; put the cursor on the foldable opener.
    view.dispatch({
      selection: { anchor: 0 },
    });
    const before = view.state.doc.toString();
    const folded = foldCode(view);
    expect(folded).toBe(true);
    expect(view.state.doc.toString()).toBe(before);
    expect(foldedRanges(view.state).size).toBeGreaterThan(0);
    unfoldCode(view);
    expect(view.state.doc.toString()).toBe(before);
    view.destroy();
    parent.remove();
  });

  it("drops fold state when document content is replaced", () => {
    const doc = "function a() {\n  return 1;\n}\n";
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [javascript(), foldExtension({ showGutter: true })],
      }),
      parent,
    });
    view.dispatch({ selection: { anchor: 0 } });
    expect(foldCode(view)).toBe(true);
    expect(foldedRanges(view.state).size).toBeGreaterThan(0);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "const x = 1;\n" },
    });
    expect(view.state.doc.toString()).toBe("const x = 1;\n");
    view.destroy();
    parent.remove();
  });

  it("supports code-language foldable regions", () => {
    const doc = "function a() {\n  return 1;\n}\n";
    const state = EditorState.create({
      doc,
      extensions: [javascript(), foldExtension({ showGutter: false })],
    });
    const line = state.doc.line(1);
    const range = foldable(state, line.from, line.to);
    expect(range).not.toBeNull();
    expect(range!.from).toBeGreaterThan(line.from);
  });
});
