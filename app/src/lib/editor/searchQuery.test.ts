import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import {
  buildReplaceAllChanges,
  countMatches,
  createSearchQuery,
  expandReplacement,
  findAllRangesInString,
  findAllRangesInText,
  isQueryBlank,
  replaceAllInString,
  validateSearchQuery,
  type SearchQuery,
} from "./searchQuery";

function lit(text: string, opts: Partial<SearchQuery> = {}): SearchQuery {
  return createSearchQuery({ text, regexp: false, ...opts });
}

function re(text: string, opts: Partial<SearchQuery> = {}): SearchQuery {
  return createSearchQuery({ text, regexp: true, ...opts });
}

describe("validateSearchQuery", () => {
  it("rejects a blank query", () => {
    expect(validateSearchQuery(lit(""))).toEqual({
      ok: false,
      reason: "Search query is empty.",
    });
  });

  it("accepts a literal query", () => {
    expect(validateSearchQuery(lit("foo"))).toEqual({ ok: true });
  });

  it("rejects invalid regex with a message", () => {
    const result = validateSearchQuery(re("(foo"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("accepts valid regex", () => {
    expect(validateSearchQuery(re("foo.*bar"))).toEqual({ ok: true });
  });
});

describe("isQueryBlank", () => {
  it("is blank for empty text", () => {
    expect(isQueryBlank(lit(""))).toBe(true);
  });
  it("is not blank for non-empty text", () => {
    expect(isQueryBlank(lit("x"))).toBe(false);
  });
});

describe("findAllRangesInString — literal", () => {
  it("finds case-insensitive matches by default", () => {
    const ranges = findAllRangesInString("Alpha alpha ALPHA", lit("alpha"));
    expect(ranges).toEqual([
      { from: 0, to: 5 },
      { from: 6, to: 11 },
      { from: 12, to: 17 },
    ]);
  });

  it("respects case-sensitive flag", () => {
    const ranges = findAllRangesInString("Alpha alpha ALPHA", lit("Alpha", { caseSensitive: true }));
    expect(ranges).toEqual([{ from: 0, to: 5 }]);
  });

  it("matches special regex characters literally", () => {
    const ranges = findAllRangesInString("a.b a.b", lit("a.b"));
    expect(ranges).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
    ]);
  });

  it("returns empty for no matches", () => {
    expect(findAllRangesInString("hello", lit("xyz"))).toEqual([]);
  });
});

describe("findAllRangesInString — whole-word", () => {
  it("only matches whole words", () => {
    const ranges = findAllRangesInString("foo foobar barfoo foo", lit("foo", { wholeWord: true }));
    expect(ranges).toEqual([
      { from: 0, to: 3 },
      { from: 18, to: 21 },
    ]);
  });

  it("respects case sensitivity with whole word", () => {
    const ranges = findAllRangesInString("Foo foo", lit("Foo", { wholeWord: true, caseSensitive: true }));
    expect(ranges).toEqual([{ from: 0, to: 3 }]);
  });
});

describe("findAllRangesInString — regex", () => {
  it("matches a regex pattern", () => {
    const ranges = findAllRangesInString("a1 b2 c3", re("\\w(\\d)"));
    expect(ranges).toEqual([
      { from: 0, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 8 },
    ]);
  });

  it("handles anchors", () => {
    const ranges = findAllRangesInString("foo\nbar\nfoo", re("^foo", { caseSensitive: true }));
    expect(ranges).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });

  it("handles capture groups in regex mode", () => {
    const ranges = findAllRangesInString("2024-01-15", re("(\\d+)-(\\d+)-(\\d+)"));
    expect(ranges).toEqual([{ from: 0, to: 10 }]);
  });
});

describe("zero-length matches", () => {
  it("finds zero-length regex matches without infinite loop", () => {
    const ranges = findAllRangesInString("abc", re("a*"));
    // `a*` produces one real match ("a") plus zero-length matches.
    expect(ranges.length).toBeGreaterThan(0);
  });

  it("does not hang for word-boundary zero-length patterns", () => {
    const ranges = findAllRangesInString("hello world", re("\\b"));
    expect(ranges.length).toBeGreaterThan(0);
  });
});

describe("findAllRangesInText", () => {
  it("works with a CodeMirror Text", () => {
    const text = Text.of(["alpha beta", "beta gamma"]);
    const ranges = findAllRangesInText(text, lit("beta"));
    expect(ranges).toEqual([
      { from: 6, to: 10 },
      { from: 11, to: 15 },
    ]);
  });
});

describe("expandReplacement", () => {
  it("returns replacement verbatim in literal mode", () => {
    expect(expandReplacement("$1 $&", null, false)).toBe("$1 $&");
  });

  it("expands numbered capture groups", () => {
    const match = /(\w)(\d)/.exec("a1")!;
    expect(expandReplacement("$2-$1", match, true)).toBe("1-a");
  });

  it("expands named capture groups", () => {
    const match = /(?<year>\d{4})/.exec("2024")!;
    expect(expandReplacement("$<year>", match, true)).toBe("2024");
  });

  it("expands $& to the full match", () => {
    const match = /\d+/.exec("123")!;
    expect(expandReplacement("[$&]", match, true)).toBe("[123]");
  });

  it("escapes $$ to literal $", () => {
    const match = /\d+/.exec("5")!;
    expect(expandReplacement("$$5", match, true)).toBe("$5");
  });

  it("handles missing capture groups gracefully", () => {
    const match = /(\d)/.exec("1")!;
    expect(expandReplacement("$1-$2", match, true)).toBe("1-");
  });
});

describe("replaceAllInString", () => {
  it("replaces all literal matches", () => {
    const result = replaceAllInString("foo bar foo", lit("foo", { replacement: "baz" }));
    expect(result).toEqual({ text: "baz bar baz", count: 2 });
  });

  it("respects case sensitivity", () => {
    const result = replaceAllInString("Foo foo FOO", lit("foo", { replacement: "x", caseSensitive: true }));
    expect(result).toEqual({ text: "Foo x FOO", count: 1 });
  });

  it("replaces with regex captures", () => {
    const result = replaceAllInString("2024-01-15", re("(\\d+)-(\\d+)-(\\d+)", { replacement: "$3/$2/$1" }));
    expect(result).toEqual({ text: "15/01/2024", count: 1 });
  });

  it("handles whole-word replacement", () => {
    const result = replaceAllInString("foo foobar foo", lit("foo", { replacement: "X", wholeWord: true }));
    expect(result).toEqual({ text: "X foobar X", count: 2 });
  });

  it("returns source unchanged when no matches", () => {
    const result = replaceAllInString("hello", lit("xyz", { replacement: "Y" }));
    expect(result).toEqual({ text: "hello", count: 0 });
  });

  it("returns source unchanged for blank query", () => {
    const result = replaceAllInString("hello", lit("", { replacement: "Y" }));
    expect(result).toEqual({ text: "hello", count: 0 });
  });

  it("handles replacement with literal dollar signs in literal mode", () => {
    const result = replaceAllInString("foo", lit("foo", { replacement: "$5" }));
    expect(result).toEqual({ text: "$5", count: 1 });
  });

  it("inserts replacement for zero-length regex matches without losing text", () => {
    const result = replaceAllInString("ab", re("a*", { replacement: "X" }));
    expect(result.count).toBeGreaterThan(0);
    // Original characters must be preserved around the insertions.
    expect(result.text).toContain("b");
  });
});

describe("buildReplaceAllChanges", () => {
  it("builds change specs for a single transaction", () => {
    const { changes, count } = buildReplaceAllChanges(
      "foo bar foo",
      lit("foo", { replacement: "baz" }),
    );
    expect(count).toBe(2);
    expect(changes).toEqual([
      { from: 0, to: 3, insert: "baz" },
      { from: 8, to: 11, insert: "baz" },
    ]);
  });

  it("builds change specs for regex captures", () => {
    const { changes, count } = buildReplaceAllChanges(
      "a1 b2",
      re("(\\w)(\\d)", { replacement: "$2$1" }),
    );
    expect(count).toBe(2);
    expect(changes).toEqual([
      { from: 0, to: 2, insert: "1a" },
      { from: 3, to: 5, insert: "2b" },
    ]);
  });
});

describe("countMatches", () => {
  it("counts matches without building replacement", () => {
    expect(countMatches("foo foo foo", lit("foo"))).toBe(3);
    expect(countMatches("hello", lit("xyz"))).toBe(0);
  });
});

describe("editor/project semantic agreement", () => {
  // The same query model must produce the same matches in both contexts.
  it("literal case-insensitive matches agree", () => {
    const content = "Alpha alpha ALPHA";
    const query = lit("alpha");
    const ranges = findAllRangesInString(content, query);
    expect(ranges.length).toBe(3);
    // Project search maps these ranges to line/column using the same offsets.
  });

  it("regex matches agree", () => {
    const content = "foo123 bar456";
    const query = re("[a-z]+\\d+");
    const ranges = findAllRangesInString(content, query);
    expect(ranges).toEqual([
      { from: 0, to: 6 },
      { from: 7, to: 13 },
    ]);
  });
});
