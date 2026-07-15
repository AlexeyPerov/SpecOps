/**
 * Unified search query model shared by in-file (editor) and project-wide search.
 *
 * Pure TypeScript — no Svelte/UI, no EditorView. The matching engine uses
 * `@codemirror/search`'s `RegExpCursor` (which correctly handles zero-length
 * matches and line-by-line regex semantics) for both literal and regex queries.
 *
 * Semantics:
 * - Literal mode: query text is regex-escaped; replacement is inserted verbatim.
 * - Regex mode: query text is a raw pattern; replacement supports `$1`, `$<name>`,
 *   `$$`, and `$&` capture expansion.
 * - Whole-word wraps the pattern in `\b(?:…)\b` using ASCII word boundaries.
 * - Case-insensitive uses the RegExp `i` flag.
 */

import { Text } from "@codemirror/state";
import { RegExpCursor } from "@codemirror/search";

/** Immutable search-and-replace query. */
export interface SearchQuery {
  readonly text: string;
  readonly replacement: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regexp: boolean;
}

/** Structured validation result. Invalid regex cannot dispatch search/replace. */
export type SearchQueryValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** A matched character range (0-based offsets within the document). */
export interface MatchRange {
  from: number;
  to: number;
}

/**
 * Internal representation: compiled regex source + flags, ready for
 * `RegExpCursor`. Both literal and regex queries compile to this form so the
 * matching engine is unified.
 */
interface CompiledQuery {
  source: string;
  ignoreCase: boolean;
}

/** Escape a literal string for safe embedding inside a RegExp pattern. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile the query into a regex pattern source and case flag.
 * Literal text is escaped; whole-word wraps the pattern in ASCII `\b`.
 * Returns `null` only when the pattern source is empty.
 */
function compileQuery(query: SearchQuery): CompiledQuery | null {
  if (!query.text) {
    return null;
  }
  let source: string;
  if (query.regexp) {
    source = query.text;
  } else {
    source = escapeRegex(query.text);
  }
  if (query.wholeWord) {
    source = `\\b(?:${source})\\b`;
  }
  return { source, ignoreCase: !query.caseSensitive };
}

/**
 * Exposed compiled form for sibling editor ops that need to drive
 * `RegExpCursor` directly (e.g. find-next/find-previous with wrap).
 */
export function compileQueryInternal(query: SearchQuery): CompiledQuery | null {
  return compileQuery(query);
}

/** True when the query has no search text. */
export function isQueryBlank(query: SearchQuery): boolean {
  return !query.text;
}

/**
 * Validate the query. A blank query is invalid. In regex mode the raw pattern
 * is compiled to detect syntax errors; the error message surfaces to the UI.
 */
export function validateSearchQuery(query: SearchQuery): SearchQueryValidation {
  if (!query.text) {
    return { ok: false, reason: "Search query is empty." };
  }
  if (query.regexp) {
    try {
      // Validate the user's raw pattern (wrapping for whole-word is safe syntactically).
      void new RegExp(query.text);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : "Invalid regular expression.";
      return { ok: false, reason };
    }
  }
  return { ok: true };
}

/** Convenient factory for callers that build queries from partial params. */
export function createSearchQuery(params: {
  text: string;
  replacement?: string;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
}): SearchQuery {
  return {
    text: params.text,
    replacement: params.replacement ?? "",
    caseSensitive: params.caseSensitive ?? false,
    wholeWord: params.wholeWord ?? false,
    regexp: params.regexp ?? false,
  };
}

/**
 * Find every match range in a CodeMirror `Text` (e.g. `view.state.doc`).
 * Uses `RegExpCursor` which iterates line-by-line and correctly skips
 * zero-length matches to avoid infinite loops.
 */
export function findAllRangesInText(text: Text, query: SearchQuery): MatchRange[] {
  const compiled = compileQuery(query);
  if (!compiled) {
    return [];
  }
  const ranges: MatchRange[] = [];
  try {
    const cursor = new RegExpCursor(text, compiled.source, {
      ignoreCase: compiled.ignoreCase,
    });
    while (!cursor.next().done) {
      ranges.push({ from: cursor.value.from, to: cursor.value.to });
    }
  } catch {
    return [];
  }
  return ranges;
}

/**
 * Find every match range in a plain string. The string is wrapped as a
 * CodeMirror `Text` so the same `RegExpCursor` engine is reused. Offsets in
 * the returned ranges are 0-based character offsets within `source`.
 */
export function findAllRangesInString(source: string, query: SearchQuery): MatchRange[] {
  return findAllRangesInText(Text.of(source.split("\n")), query);
}

/**
 * Expand a replacement string using JS capture-group syntax.
 *
 * Supported tokens (regex mode only):
 * - `$$` → literal `$`
 * - `$&` → full match
 * - `$1`…`$9` → numbered capture group
 * - `$<name>` → named capture group
 *
 * For literal mode the replacement is returned verbatim.
 */
export function expandReplacement(
  replacement: string,
  match: RegExpExecArray | null,
  regexp: boolean,
): string {
  if (!regexp || !match) {
    return replacement;
  }
  let result = "";
  let i = 0;
  while (i < replacement.length) {
    const ch = replacement[i];
    if (ch !== "$" || i + 1 >= replacement.length) {
      result += ch;
      i += 1;
      continue;
    }
    const next = replacement[i + 1];
    if (next === "$") {
      result += "$";
      i += 2;
    } else if (next === "&") {
      result += match[0];
      i += 2;
    } else if (next >= "1" && next <= "9") {
      const groupIndex = Number(next);
      const groupValue = match[groupIndex];
      result += groupValue ?? "";
      i += 2;
    } else if (next === "<") {
      const close = replacement.indexOf(">", i + 2);
      if (close !== -1) {
        const name = replacement.slice(i + 2, close);
        result += match.groups?.[name] ?? "";
        i = close + 1;
      } else {
        result += "$";
        i += 1;
      }
    } else {
      result += "$";
      i += 1;
    }
  }
  return result;
}

/**
 * Replace every match in `source` with the query's replacement. Returns the
 * new text and the number of replacements made.
 *
 * Zero-length matches insert the replacement without consuming source text;
 * `RegExpCursor` ensures the position always advances so no infinite loop
 * occurs.
 */
export function replaceAllInString(
  source: string,
  query: SearchQuery,
): { text: string; count: number } {
  const compiled = compileQuery(query);
  if (!compiled) {
    return { text: source, count: 0 };
  }
  const text = Text.of(source.split("\n"));
  const pieces: string[] = [];
  let writePos = 0;
  let count = 0;
  try {
    const cursor = new RegExpCursor(text, compiled.source, {
      ignoreCase: compiled.ignoreCase,
    });
    while (!cursor.next().done) {
      const { from, to, match } = cursor.value;
      if (from > writePos) {
        pieces.push(source.slice(writePos, from));
      }
      if (query.regexp) {
        pieces.push(expandReplacement(query.replacement, match, true));
      } else {
        pieces.push(query.replacement);
      }
      count += 1;
      // For zero-length matches (from === to) writePos stays put so the
      // character at that offset is preserved in the output.
      writePos = to;
    }
  } catch {
    return { text: source, count: 0 };
  }
  if (count === 0) {
    return { text: source, count: 0 };
  }
  if (writePos < source.length) {
    pieces.push(source.slice(writePos));
  }
  return { text: pieces.join(""), count };
}

/**
 * Build CodeMirror change specs for an in-editor replace-all so it dispatches
 * as a single undoable transaction. Each entry is `{ from, to, insert }`.
 */
export function buildReplaceAllChanges(
  source: string,
  query: SearchQuery,
): { changes: { from: number; to: number; insert: string }[]; count: number } {
  const compiled = compileQuery(query);
  if (!compiled) {
    return { changes: [], count: 0 };
  }
  const text = Text.of(source.split("\n"));
  const changes: { from: number; to: number; insert: string }[] = [];
  let count = 0;
  try {
    const cursor = new RegExpCursor(text, compiled.source, {
      ignoreCase: compiled.ignoreCase,
    });
    while (!cursor.next().done) {
      const { from, to, match } = cursor.value;
      const insert = query.regexp
        ? expandReplacement(query.replacement, match, true)
        : query.replacement;
      changes.push({ from, to, insert });
      count += 1;
    }
  } catch {
    return { changes: [], count: 0 };
  }
  return { changes, count };
}

/**
 * Count matches without producing replacement text. Used for pre-flight
 * confirmation dialogs.
 */
export function countMatches(source: string, query: SearchQuery): number {
  return findAllRangesInString(source, query).length;
}
