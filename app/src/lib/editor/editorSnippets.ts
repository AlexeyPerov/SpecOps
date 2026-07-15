/**
 * CodeMirror Markdown snippet insertion and completion (M6.1).
 *
 * Lives behind the reserved `snippets` compartment. Completion entries are
 * merged into the M5 `completion` compartment via `completionExtension`.
 * Snippet sessions are ephemeral editor state and never persist.
 *
 * Multi-cursor policy: insert at the main selection only when more than one
 * range is active (tab-stop navigation is not coherent across cursors).
 * Privacy: never log snippet bodies or document text.
 */
import { Prec, type Extension } from "@codemirror/state";
import {
  snippet,
  snippetCompletion,
  snippetKeymap,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorView, keymap } from "@codemirror/view";
import type { ResolvedMarkdownSnippet } from "../domain/snippets";
import { prepareSnippetBody } from "./markdownSnippetSettings";

export type SnippetExtensionOptions = {
  /** When false, the compartment contributes no keymap/source. */
  enabled: boolean;
};

export type InsertSnippetResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "disabled" | "not-found"; message?: string };

/**
 * Snippet keymap (Tab / Shift-Tab / Escape). Always registered when the
 * snippets compartment is enabled so tab-stop navigation works after insert
 * or completion accept. When no snippet session is active, Tab falls through
 * to indent.
 */
export function snippetExtension(options: SnippetExtensionOptions): Extension {
  if (!options.enabled) {
    return [];
  }
  return Prec.high(keymap.compute([snippetKeymap], (state) => state.facet(snippetKeymap)));
}

/**
 * Build a completion source for enabled Markdown snippets. Matches against
 * the word/trigger prefix before the cursor (same prefix rule as word
 * completion: at least one character).
 */
export function createSnippetCompletionSource(
  snippets: readonly ResolvedMarkdownSnippet[],
): CompletionSource {
  const catalog = snippets.filter((entry) => entry.enabled && entry.body.length > 0);

  return (context: CompletionContext): CompletionResult | null => {
    if (catalog.length === 0) {
      return null;
    }
    const match = context.matchBefore(/[a-zA-Z][a-zA-Z0-9_-]*/);
    if (!match || (match.from === match.to && !context.explicit)) {
      return null;
    }
    const prefix = match.text.toLowerCase();
    const options = catalog
      .filter((entry) => {
        const trigger = entry.trigger.toLowerCase();
        const name = entry.name.toLowerCase();
        return trigger.startsWith(prefix) || name.startsWith(prefix);
      })
      .map((entry) =>
        snippetCompletion(entry.body, {
          label: entry.trigger,
          detail: entry.name,
          info: entry.description || undefined,
          type: "keyword",
          boost: entry.trigger.toLowerCase().startsWith(prefix) ? 2 : 0,
        }),
      );
    if (options.length === 0) {
      return null;
    }
    return {
      from: match.from,
      to: match.to,
      options,
      validFor: /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    };
  };
}

/**
 * Insert a resolved snippet at the main selection. Substitutes `${SELECTION}`,
 * adapts indentation/line endings via CodeMirror's snippet engine, and starts
 * an ephemeral tab-stop session when placeholders exist.
 */
export function insertMarkdownSnippet(
  view: EditorView,
  entry: ResolvedMarkdownSnippet,
): InsertSnippetResult {
  if (!entry.body) {
    return { ok: false, reason: "disabled", message: "Snippet body is empty." };
  }

  const { state } = view;
  const main = state.selection.main;
  if (state.selection.ranges.length > 1) {
    // Coherent multi-cursor tab-stop navigation is not supported — main only.
    // Caller surfaces the status message.
  }

  const selectedText = main.empty ? "" : state.sliceDoc(main.from, main.to);
  let prepared: string;
  try {
    prepared = prepareSnippetBody(entry.body, selectedText);
  } catch {
    return {
      ok: false,
      reason: "disabled",
      message: "Snippet template could not be prepared.",
    };
  }

  try {
    const apply = snippet(prepared);
    apply(view, null, main.from, main.from);
  } catch {
    return {
      ok: false,
      reason: "disabled",
      message: "Snippet template is invalid.",
    };
  }

  return { ok: true };
}

/** Stable fingerprint for reconfigure skipping (ids + triggers + bodies). */
export function snippetCatalogKey(snippets: readonly ResolvedMarkdownSnippet[]): string {
  return snippets
    .map((entry) => `${entry.id}\0${entry.trigger}\0${entry.body.length}\0${entry.enabled ? 1 : 0}`)
    .join("\n");
}
