import { describe, expect, it } from "vitest";
import { computeFileMatches, totalMatchCount } from "./projectSearch";
import { createSearchQuery } from "../editor/searchQuery";

function lit(text: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}) {
  return createSearchQuery({
    text,
    replacement: "",
    caseSensitive: opts.caseSensitive ?? false,
    wholeWord: opts.wholeWord ?? false,
    regexp: false,
  });
}

function re(text: string, opts: { caseSensitive?: boolean } = {}) {
  return createSearchQuery({
    text,
    replacement: "",
    caseSensitive: opts.caseSensitive ?? false,
    wholeWord: false,
    regexp: true,
  });
}

describe("computeFileMatches", () => {
  it("returns no matches for empty query", () => {
    expect(computeFileMatches("foo bar", lit(""))).toEqual([]);
  });

  it("maps offsets to 1-based line and column", () => {
    const content = "alpha beta\nbeta gamma\n";
    const matches = computeFileMatches(content, lit("beta"));
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ line: 1, column: 7 });
    expect(matches[1]).toMatchObject({ line: 2, column: 1 });
    expect(matches[0].lineText).toBe("alpha beta");
    expect(matches[1].lineText).toBe("beta gamma");
  });

  it("respects case sensitivity", () => {
    const content = "Foo foo FOO";
    expect(computeFileMatches(content, lit("foo"))).toHaveLength(3);
    expect(computeFileMatches(content, lit("foo", { caseSensitive: true }))).toHaveLength(1);
    expect(computeFileMatches(content, lit("foo", { caseSensitive: true }))[0]).toMatchObject({
      line: 1,
      column: 5,
    });
  });

  it("handles trailing content with no final newline", () => {
    const matches = computeFileMatches("x\ny\nz", lit("z"));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ line: 3, column: 1 });
    expect(matches[0].lineText).toBe("z");
  });

  it("counts multiple matches on the same line", () => {
    const matches = computeFileMatches("ab ab ab", lit("ab"));
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.column)).toEqual([1, 4, 7]);
  });

  it("records match length and end offset", () => {
    const matches = computeFileMatches("alpha beta", lit("alpha"));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ from: 0, to: 5, length: 5 });
  });

  it("supports whole-word matching", () => {
    const content = "foo foobar barfoo foo";
    const matches = computeFileMatches(content, lit("foo", { wholeWord: true }));
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.column)).toEqual([1, 19]);
  });

  it("supports regex matching", () => {
    const content = "a1 b2 c3";
    const matches = computeFileMatches(content, re("\\w\\d"));
    expect(matches).toHaveLength(3);
    expect(matches[0]).toMatchObject({ from: 0, to: 2, length: 2 });
  });

  it("supports regex capture-group match ranges", () => {
    const content = "2024-01-15";
    const matches = computeFileMatches(content, re("\\d+-\\d+-\\d+"));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ from: 0, to: 10, length: 10 });
  });
});

describe("totalMatchCount", () => {
  it("sums matches across files", () => {
    const results = [
      { path: "a", matches: [{ line: 1, column: 1, lineText: "x", from: 0, to: 1, length: 1 }] },
      {
        path: "b",
        matches: [
          { line: 1, column: 1, lineText: "x", from: 0, to: 1, length: 1 },
          { line: 2, column: 3, lineText: "y", from: 2, to: 3, length: 1 },
        ],
      },
    ];
    expect(totalMatchCount(results)).toBe(3);
    expect(totalMatchCount([])).toBe(0);
  });
});
