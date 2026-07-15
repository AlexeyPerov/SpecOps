/**
 * CodeMirror typing-assistance extensions (M5): auto-close bracket/quote pairs
 * and a bounded local document-word completion source.
 *
 * Both features live behind the reserved `completion` compartment
 * (`editorExtensions.ts`) and reconfigure together when either setting flips,
 * so toggling them is live and never rebuilds the editor surface.
 *
 * Privacy: the completion source only reads the active document. It never
 * reads other files, AI context, or network sources, and it never logs
 * document text.
 */
import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Documents larger than this switch from a full scan to a windowed scan
 * centered on the cursor (plus a head sample) so completion stays responsive
 * on large files.
 */
const LARGE_DOC_THRESHOLD_CHARS = 500_000;
/** Half-width of the cursor-centered window used by the bounded scan. */
const WINDOW_HALF_CHARS = 100_000;
/** Head sample size combined with the window for the bounded scan. */
const HEAD_SAMPLE_CHARS = 50_000;
/** Hard cap on the number of completion candidates returned. */
const MAX_CANDIDATES = 200;
/** Maximum tokens scanned before the windowed/full scan stops early. */
const MAX_TOKENS_SCANNED = 20_000;

/** Unicode-aware word character class (letters, digits, underscore). */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Global regex used to scan tokens out of a document slice. */
const WORD_SCAN_GLOBAL = /[\p{L}\p{N}_]+/gu;

export type CompletionExtensionOptions = {
  /**
   * When true (default), typing an opener inserts the matching closer and
   * leaves the cursor inside; typing an existing closer steps over it.
   */
  autoClosePairs: boolean;
  /**
   * When true, completion suggestions appear automatically while typing.
   * Manual completion (`Ctrl+Space` / `edit.triggerCompletion`) works
   * regardless of this setting. Defaults off — opt-in for noise-sensitive
   * note-taking.
   */
  autoSuggest: boolean;
  /**
   * Optional Markdown snippet completion source (M6). Combined with the
   * local word source; omitted/empty when snippets are disabled or the
   * document is not Markdown.
   */
  snippetSource?: CompletionSource | null;
};

/**
 * Extract the word prefix immediately before the cursor for the given context.
 * Returns null when the cursor is not preceded by at least one word character
 * (so completion does not fire after punctuation or whitespace).
 *
 * Exported for unit testing.
 */
export function wordPrefixBefore(context: CompletionContext): string | null {
  const pos = context.pos;
  const doc = context.state.doc;
  if (pos <= 0) {
    return null;
  }
  const line = doc.lineAt(pos);
  // Only look at the current line for the prefix (matches typical editor UX).
  let start = pos;
  while (start > line.from && WORD_CHAR.test(line.text[start - 1 - line.from])) {
    start -= 1;
  }
  if (start === pos) {
    return null;
  }
  return line.text.slice(start - line.from, pos - line.from);
}

type ScoredCandidate = {
  text: string;
  /** Lower (more negative) = nearer the cursor = ranked first. */
  distance: number;
  /** Longer useful prefixes rank higher on ties. */
  length: number;
};

/**
 * Build the candidate list for a document-word completion query. Pure and
 * content-agnostic in its return shape — callers never see raw document text
 * beyond the matched words themselves.
 *
 * Bounds:
 * - Documents above {@link LARGE_DOC_THRESHOLD_CHARS} scan a cursor-centered
 *   window plus a head sample instead of the whole document.
 * - At most {@link MAX_TOKENS_SCANNED} tokens are considered.
 * - At most {@link MAX_CANDIDATES} candidates are returned.
 *
 * Ranking: nearer occurrences first, then longer words. The exact current
 * token (the prefix word) is excluded so completion never offers the word
 * being typed.
 *
 * Exported for unit testing.
 */
export function buildLocalWordCandidates(
  state: EditorState,
  pos: number,
  prefix: string,
): string[] {
  const docLength = state.doc.length;
  if (docLength === 0 || prefix.length === 0) {
    return [];
  }

  let scanText: string;
  let cursorOffset = pos;
  if (docLength <= LARGE_DOC_THRESHOLD_CHARS) {
    scanText = state.doc.toString();
  } else {
    const windowStart = Math.max(0, pos - WINDOW_HALF_CHARS);
    const windowEnd = Math.min(docLength, pos + WINDOW_HALF_CHARS);
    const headEnd = Math.min(docLength, HEAD_SAMPLE_CHARS);
    const slices: string[] = [];
    if (headEnd > 0 && headEnd < windowStart) {
      slices.push(state.sliceDoc(0, headEnd));
    }
    slices.push(state.sliceDoc(windowStart, windowEnd));
    scanText = slices.join("\n");
    cursorOffset = pos - windowStart + (slices.length > 1 ? headEnd + 1 : 0);
  }

  const prefixLower = prefix.toLowerCase();
  const seen = new Set<string>();
  /** Tracks the lowercased form to dedupe case variants. */
  const seenLower = new Set<string>();
  const candidates: ScoredCandidate[] = [];
  const currentTokenLower = prefixLower;

  const globalRegex = new RegExp(WORD_SCAN_GLOBAL.source, "gu");
  let tokensScanned = 0;
  let match: RegExpExecArray | null;
  while ((match = globalRegex.exec(scanText)) !== null) {
    if (tokensScanned >= MAX_TOKENS_SCANNED) {
      break;
    }
    tokensScanned += 1;
    const token = match[0];
    if (token.length < 2) {
      // Single-character tokens add noise; skip them.
      continue;
    }
    const tokenLower = token.toLowerCase();
    if (tokenLower === currentTokenLower) {
      // Exclude the exact token being typed.
      continue;
    }
    if (!tokenLower.startsWith(prefixLower)) {
      continue;
    }
    if (seenLower.has(tokenLower)) {
      continue;
    }
    seenLower.add(tokenLower);
    seen.add(token);
    const matchPos = match.index;
    const distance = Math.abs(matchPos - cursorOffset);
    candidates.push({ text: token, distance, length: token.length });
    if (candidates.length >= MAX_CANDIDATES) {
      break;
    }
  }

  // Stable-ish ordering: nearer first, then longer first. Ties keep scan order.
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return b.length - a.length;
  });
  return candidates.map((candidate) => candidate.text);
}

/**
 * Completion source that suggests words already present in the active
 * document. Privacy-preserving: reads only the current document.
 */
export const localWordSource: CompletionSource = (
  context: CompletionContext,
): CompletionResult | null => {
  const prefix = wordPrefixBefore(context);
  if (!prefix) {
    return null;
  }
  const candidates = buildLocalWordCandidates(context.state, context.pos, prefix);
  if (candidates.length === 0) {
    return null;
  }
  return {
    from: context.pos - prefix.length,
    to: context.pos,
    options: candidates.map((label) => ({ label, type: "text" })),
    // Stay valid while the user keeps typing word characters that extend the
    // prefix. `text` is the slice between `from` and the current cursor.
    validFor: /^[\p{L}\p{N}_]+$/u,
  };
};

/**
 * Theme rules for the completion tooltip and selected option. Uses existing
 * surface/border/text tokens so completion matches the editor's theme.
 */
export function completionTheme(): Extension {
  return EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete": {
      border: "1px solid var(--color-border-subtle)",
      backgroundColor: "var(--color-surface-1)",
      borderRadius: "var(--radius-md, 4px)",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
      fontFamily: "var(--font-family-ui)",
      fontSize: "var(--font-size-editor, 13px)",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      padding: "1px 8px",
      color: "var(--color-text-primary)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--color-hover)",
      color: "var(--color-text-primary)",
    },
    ".cm-tooltip-autocomplete > ul > li .cm-completionDetail": {
      color: "var(--color-text-secondary)",
    },
    ".cm-tooltip-autocomplete > ul.completions": {
      maxHeight: "260px",
    },
  });
}

/**
 * Completion extension group for the reserved `completion` compartment.
 *
 * - `autoClosePairs` toggles `closeBrackets` + its keymap (brackets, parens,
 *   quotes, backticks). Emphasis markers (`*`/`_`) are intentionally not
 *   auto-closed — their behavior is not predictable enough for conservative
 *   Markdown editing. Standard `closeBrackets` covers the predictable pairs.
 * - `autoSuggest` toggles automatic `activateOnTyping` completion. Manual
 *   completion (`edit.triggerCompletion` / `Ctrl+Space`) works either way.
 *
 * The `completionKeymap` (Enter to accept, Escape to dismiss, arrows to move)
 * is always registered. It does not bind Tab, so Tab keeps indenting via
 * `indentWithTab`.
 */
export function completionExtension(options: CompletionExtensionOptions): Extension {
  const { autoClosePairs, autoSuggest, snippetSource = null } = options;
  const groups: Extension[] = [];
  if (autoClosePairs) {
    groups.push(closeBrackets(), keymap.of([...closeBracketsKeymap]));
  }
  const sources: CompletionSource[] = [localWordSource];
  if (snippetSource) {
    sources.push(snippetSource);
  }
  groups.push(
    autocompletion({
      activateOnTyping: autoSuggest,
      override: sources,
      defaultKeymap: false,
      maxRenderedOptions: MAX_CANDIDATES,
      optionClass: () => "specops-completion-option",
    }),
    keymap.of([...completionKeymap]),
    completionTheme(),
  );
  return groups;
}
