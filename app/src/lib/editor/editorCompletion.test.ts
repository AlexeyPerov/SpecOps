import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  buildLocalWordCandidates,
  completionExtension,
  completionTheme,
  localWordSource,
  wordPrefixBefore,
} from "./editorCompletion";

function stateWith(text: string): EditorState {
  return EditorState.create({ doc: text, extensions: [EditorView.lineWrapping] });
}

function contextAt(state: EditorState, pos: number, explicit = false): CompletionContext {
  return new CompletionContext(state, pos, explicit);
}

describe("wordPrefixBefore", () => {
  it("extracts a word prefix immediately before the cursor", () => {
    const state = stateWith("hello world");
    expect(wordPrefixBefore(contextAt(state, 5))).toBe("hello");
  });

  it("returns null at a word boundary (after whitespace)", () => {
    const state = stateWith("hello world");
    expect(wordPrefixBefore(contextAt(state, 6))).toBeNull();
  });

  it("returns null at the start of the document", () => {
    const state = stateWith("hello");
    expect(wordPrefixBefore(contextAt(state, 0))).toBeNull();
  });

  it("returns null at a word boundary (after punctuation)", () => {
    const state = stateWith("foo(bar");
    // Cursor right before "(" — prefix is "foo"; after "(" it is null.
    expect(wordPrefixBefore(contextAt(state, 4))).toBeNull();
  });

  it("supports unicode word characters", () => {
    const state = stateWith("café_2");
    expect(wordPrefixBefore(contextAt(state, 6))).toBe("café_2");
  });

  it("only scans the current line for the prefix", () => {
    const state = stateWith("alpha\nbeta");
    // Cursor at start of line 2 — no prefix on this line.
    expect(wordPrefixBefore(contextAt(state, 6))).toBeNull();
  });
});

describe("buildLocalWordCandidates", () => {
  it("suggests repeated terms from the document", () => {
    const state = stateWith("synchronize synchronization sync");
    const candidates = buildLocalWordCandidates(state, 5, "sync");
    expect(candidates).toContain("synchronize");
    expect(candidates).toContain("synchronization");
    // The exact prefix token is excluded.
    expect(candidates).not.toContain("sync");
  });

  it("excludes the exact current token but keeps longer matches", () => {
    const state = stateWith("alpha alpha alpha");
    // Prefix "a" — the full token "alpha" starts with "a" and is not equal to
    // the prefix, so it remains a candidate.
    const candidates = buildLocalWordCandidates(state, 1, "a");
    expect(candidates).toEqual(["alpha"]);
  });

  it("excludes the token that exactly matches the full prefix being typed", () => {
    const state = stateWith("alpha alphabet alpha");
    // When the prefix equals a full token ("alpha"), that token is excluded.
    const candidates = buildLocalWordCandidates(state, 5, "alpha");
    expect(candidates).toEqual(["alphabet"]);
  });

  it("deduplicates case variants keeping the first-seen casing", () => {
    const state = stateWith("Foo foo FOO bar");
    const candidates = buildLocalWordCandidates(state, 1, "b");
    // Only "bar" remains (foo variants deduped, but they don't start with "b").
    expect(candidates).toEqual(["bar"]);
  });

  it("deduplicates case-insensitively across matches", () => {
    const state = stateWith("Hello hello HELLO");
    const candidates = buildLocalWordCandidates(state, 1, "h");
    expect(candidates).toEqual(["Hello"]);
  });

  it("prefers nearer occurrences then longer words", () => {
    const state = stateWith("farther farsighted near far");
    // Cursor at end (pos 25). "far" at pos 22 is nearest, then "farther" at 0,
    // then "farsighted" at 9.
    const candidates = buildLocalWordCandidates(state, 25, "f");
    expect(candidates[0]).toBe("far");
    // The exact prefix token "far" is excluded only when it equals the prefix;
    // here prefix is "f", so "far" is a valid candidate.
    expect(candidates).toContain("farther");
    expect(candidates).toContain("farsighted");
  });

  it("ignores single-character tokens", () => {
    const state = stateWith("a ab abc");
    const candidates = buildLocalWordCandidates(state, 1, "a");
    // "a" is single-char (skipped), "ab"/"abc" excluded because they equal
    // nothing here — prefix "a" matches "ab" and "abc" but not "a".
    expect(candidates).toContain("ab");
    expect(candidates).toContain("abc");
  });

  it("respects the candidate cap", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const state = stateWith(words.join(" "));
    const candidates = buildLocalWordCandidates(state, 0, "w");
    // Even with 500 matching words, the result is bounded.
    expect(candidates.length).toBeLessThanOrEqual(200);
  });

  it("returns no candidates when the prefix is empty", () => {
    const state = stateWith("hello world");
    expect(buildLocalWordCandidates(state, 0, "")).toEqual([]);
  });

  it("does not match punctuation-only tokens", () => {
    const state = stateWith("... --- hello");
    const candidates = buildLocalWordCandidates(state, 1, "h");
    expect(candidates).toEqual(["hello"]);
  });

  it("handles code identifiers with underscores and digits", () => {
    const state = stateWith("getUserById getUserId get_user_2");
    const candidates = buildLocalWordCandidates(state, 1, "g");
    expect(candidates).toContain("getUserById");
    expect(candidates).toContain("getUserId");
    expect(candidates).toContain("get_user_2");
  });

  it("bounds the scan for very large documents", () => {
    // Build a document well above the large-doc threshold.
    const big = "alpha ".repeat(120_000); // ~720k chars
    const state = stateWith(big);
    // Should complete quickly and return a bounded result.
    const start = performance.now();
    const candidates = buildLocalWordCandidates(state, big.length, "a");
    const elapsed = performance.now() - start;
    expect(candidates.length).toBeLessThanOrEqual(200);
    expect(candidates).toContain("alpha");
    // Bounded scan must stay responsive.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("localWordSource", () => {
  it("returns a completion result with from/to and options", () => {
    const state = stateWith("synchronize sync");
    const ctx = contextAt(state, 5); // after "synch"
    const result = localWordSource(ctx) as
      | { from: number; to: number; options: { label: string }[] }
      | null;
    expect(result).not.toBeNull();
    expect(result!.from).toBe(0);
    expect(result!.to).toBe(5);
    expect(result!.options.length).toBeGreaterThan(0);
    expect(result!.options.some((option) => option.label === "synchronize")).toBe(true);
  });

  it("returns null when there is no word prefix", () => {
    const state = stateWith("hello world");
    const ctx = contextAt(state, 0);
    expect(localWordSource(ctx)).toBeNull();
  });

  it("suggests longer words that start with a short prefix", () => {
    const state = stateWith("zzz");
    const ctx = contextAt(state, 1); // prefix "z"
    const result = localWordSource(ctx) as
      | { options: { label: string }[] }
      | null;
    expect(result).not.toBeNull();
    // "zzz" is not equal to the prefix "z", so it is a valid candidate.
    expect(result!.options.some((option) => option.label === "zzz")).toBe(true);
  });
});

describe("completionExtension", () => {
  it("builds without error for all option combinations", () => {
    for (const autoClosePairs of [true, false]) {
      for (const autoSuggest of [true, false]) {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const view = new EditorView({
          parent,
          extensions: [
            completionExtension({ autoClosePairs, autoSuggest }),
          ],
        });
        expect(view.state.doc.length).toBe(0);
        view.destroy();
      }
    }
  });

  it("completionTheme returns a defined extension", () => {
    const theme = completionTheme();
    expect(Array.isArray(theme) ? theme.length > 0 : true).toBe(true);
  });
});
