/**
 * Markdown heading-section fold boundary helpers.
 *
 * `@codemirror/lang-markdown` already registers a heading fold service
 * (ATX + setext → next heading of equal/higher level). This module provides
 * pure boundary computation for tests and documentation, plus a thin wrapper
 * around CodeMirror `foldable` for integration checks.
 *
 * Fenced code blocks remain governed by language syntax-tree folds, not this
 * heading fallback.
 */
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, foldable } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import {
  extractMarkdownHeadingsFromText,
  type MarkdownHeading,
} from "./markdownHeadings";

export type MarkdownFoldBoundary = {
  /** Start of the fold (typically end of the heading line). */
  from: number;
  /** End of the section (exclusive of the next equal/higher heading). */
  to: number;
  heading: MarkdownHeading;
};

/**
 * Pure fold boundaries: from the end of each heading line to the start of the
 * next heading with level <= current (or EOF). Nested lower-level headings are
 * included inside the parent fold range.
 */
export function computeMarkdownHeadingFoldBoundaries(
  text: string,
): MarkdownFoldBoundary[] {
  const headings = extractMarkdownHeadingsFromText(text);
  if (headings.length === 0) {
    return [];
  }

  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const docLength = text.length;

  function lineEnd(lineNumber: number): number {
    const line = lines[lineNumber - 1] ?? "";
    const start = lineStarts[lineNumber - 1] ?? 0;
    return start + line.length;
  }

  const boundaries: MarkdownFoldBoundary[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    let end = docLength;
    for (let j = i + 1; j < headings.length; j++) {
      const next = headings[j]!;
      if (next.level <= heading.level) {
        end = next.from;
        break;
      }
    }
    const from = lineEnd(heading.line);
    if (end > from) {
      boundaries.push({ from, to: end, heading });
    }
  }
  return boundaries;
}

/** Build an EditorState with markdown language support for fold checks. */
export function createMarkdownFoldTestState(doc: string): EditorState {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ addKeymap: false })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/**
 * Returns the CodeMirror foldable range for the heading line, if any.
 * Relies on lang-markdown's built-in heading fold service.
 */
export function markdownHeadingFoldableAtLine(
  state: EditorState,
  lineNumber: number,
): { from: number; to: number } | null {
  if (lineNumber < 1 || lineNumber > state.doc.lines) {
    return null;
  }
  const line = state.doc.line(lineNumber);
  return foldable(state, line.from, line.to);
}
