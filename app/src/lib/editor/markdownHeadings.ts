/**
 * Markdown heading extraction for outline navigation.
 * Prefers CodeMirror / Lezer syntax trees; pure text fallback for tests.
 */
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Tree } from "@lezer/common";

export type MarkdownHeading = {
  /** Stable-enough identity within a document generation (level + text + ordinal). */
  key: string;
  level: number;
  text: string;
  from: number;
  to: number;
  line: number;
};

const ATX_HEADING = /^(ATXHeading)(\d)$/;
const SETEXT_HEADING = /^(SetextHeading)(\d)$/;

function headingLevelFromNodeName(name: string): number | null {
  const atx = ATX_HEADING.exec(name);
  if (atx) {
    return Number(atx[2]);
  }
  const setext = SETEXT_HEADING.exec(name);
  if (setext) {
    return Number(setext[2]);
  }
  return null;
}

function displayTextFromHeadingSlice(raw: string, kind: "atx" | "setext"): string {
  if (kind === "atx") {
    return raw.replace(new RegExp(`^#{1,6}\\s*`), "").replace(/\s*#+\s*$/, "").trim();
  }
  // Setext: first line is the title; underline is the second.
  const firstLine = raw.split("\n")[0] ?? raw;
  return firstLine.trim();
}

function assignKeys(headings: Omit<MarkdownHeading, "key">[]): MarkdownHeading[] {
  const counts = new Map<string, number>();
  return headings.map((heading) => {
    const base = `${heading.level}:${heading.text}`;
    const ordinal = counts.get(base) ?? 0;
    counts.set(base, ordinal + 1);
    return {
      ...heading,
      key: `${base}#${ordinal}`,
    };
  });
}

function extractHeadingsFromTree(
  tree: Tree,
  doc: {
    sliceString: (from: number, to: number) => string;
    lineAt: (pos: number) => { number: number };
  },
): MarkdownHeading[] {
  const found: Omit<MarkdownHeading, "key">[] = [];

  tree.iterate({
    enter(node) {
      const name = node.name;
      if (
        name === "FencedCode" ||
        name === "CodeBlock" ||
        name === "HTMLBlock" ||
        name === "CommentBlock"
      ) {
        return false;
      }
      const level = headingLevelFromNodeName(name);
      if (level == null) {
        return undefined;
      }
      const from = node.from;
      const to = node.to;
      const raw = doc.sliceString(from, to);
      const kind = name.startsWith("Setext") ? "setext" : "atx";
      const text = displayTextFromHeadingSlice(raw, kind);
      const line = doc.lineAt(from).number;
      found.push({ level, text, from, to, line });
      return false;
    },
  });

  return assignKeys(found);
}

/**
 * Extract headings from an EditorState syntax tree.
 * Ignores headings nested inside FencedCode / CodeBlock / HTMLBlock.
 */
export function extractMarkdownHeadings(state: EditorState): MarkdownHeading[] {
  // Large documents may not be fully parsed yet; wait briefly for a complete tree.
  ensureSyntaxTree(state, state.doc.length, 5000);
  const tree = syntaxTree(state);
  if (tree.length < state.doc.length) {
    // Incremental parse still incomplete — fall back to a full document parse.
    return extractMarkdownHeadingsFromText(state.doc.toString());
  }
  return extractHeadingsFromTree(tree, state.doc);
}

/**
 * Pure text fallback: full Lezer markdown parse so tests and non-mounted
 * callers share syntax-aware rules without relying on incremental parsing.
 */
export function extractMarkdownHeadingsFromText(text: string): MarkdownHeading[] {
  const state = EditorState.create({
    doc: text,
    extensions: [markdown({ addKeymap: false })],
  });
  const tree = markdownLanguage.parser.parse(text);
  return extractHeadingsFromTree(tree, state.doc);
}

/** Active heading for a cursor position: nearest heading at or above the line. */
export function activeMarkdownHeading(
  headings: readonly MarkdownHeading[],
  cursorPos: number,
): MarkdownHeading | null {
  let active: MarkdownHeading | null = null;
  for (const heading of headings) {
    if (heading.from <= cursorPos) {
      active = heading;
    } else {
      break;
    }
  }
  return active;
}

/** Filter headings by case-insensitive substring match on display text. */
export function filterMarkdownHeadings(
  headings: readonly MarkdownHeading[],
  query: string,
): MarkdownHeading[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [...headings];
  }
  return headings.filter((heading) => heading.text.toLowerCase().includes(trimmed));
}
