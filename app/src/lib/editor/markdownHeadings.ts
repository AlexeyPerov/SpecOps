/**
 * Markdown heading extraction for outline navigation.
 * Prefers CodeMirror / Lezer syntax trees; pure text fallback for tests.
 */
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
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
 * Per-`EditorState` memo for {@link extractMarkdownHeadings}.
 *
 * An `EditorState` is immutable and replaced on every transaction, so keying on it
 * gives exactly "compute once per document version" with no invalidation logic. A
 * `WeakMap` means entries disappear with the state they describe.
 *
 * This matters because extraction is expensive — `ensureSyntaxTree` with a 5s budget,
 * and a fresh `EditorState` plus a full Lezer parse on the fallback path — while the
 * callers are chatty: the outline panel asks for the heading list, the active heading,
 * and the folded state of *each* heading, all against the same state, on a 500ms poll.
 * That was `2 + headings` full-document parses twice a second on a large file.
 */
const headingsByState = new WeakMap<EditorState, MarkdownHeading[]>();

/**
 * Extract headings from an EditorState syntax tree.
 * Ignores headings nested inside FencedCode / CodeBlock / HTMLBlock.
 *
 * Memoized per state; see {@link headingsByState}.
 */
export function extractMarkdownHeadings(state: EditorState): MarkdownHeading[] {
  const cached = headingsByState.get(state);
  if (cached) {
    return cached;
  }
  const headings = computeMarkdownHeadings(state);
  headingsByState.set(state, headings);
  return headings;
}

function computeMarkdownHeadings(state: EditorState): MarkdownHeading[] {
  // Large documents may not be fully parsed yet; wait briefly for a complete tree.
  // `ensureSyntaxTree` returns the completed tree when it finishes within the
  // budget — use *that* tree. Reading `syntaxTree(state)` instead returns the
  // pre-transaction field tree (still pointing at the old document length), so
  // it appears incomplete and forces the expensive text fallback on every call
  // until the background parse catches up — a double parse per extraction.
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (tree && tree.length >= state.doc.length) {
    return extractHeadingsFromTree(tree, state.doc);
  }
  // Incremental parse still incomplete (timed out or tree missing) — fall back
  // to a full document parse.
  return extractMarkdownHeadingsFromText(state.doc.toString());
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
