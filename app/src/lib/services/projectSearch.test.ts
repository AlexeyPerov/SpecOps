import { describe, expect, it } from "vitest";
import { computeFileMatches, totalMatchCount } from "./projectSearch";

describe("computeFileMatches", () => {
  it("returns no matches for empty query", () => {
    expect(computeFileMatches("foo bar", "", false)).toEqual([]);
  });

  it("maps offsets to 1-based line and column", () => {
    const content = "alpha beta\nbeta gamma\n";
    const matches = computeFileMatches(content, "beta", false);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ line: 1, column: 7 });
    expect(matches[1]).toMatchObject({ line: 2, column: 1 });
    expect(matches[0].lineText).toBe("alpha beta");
    expect(matches[1].lineText).toBe("beta gamma");
  });

  it("respects case sensitivity", () => {
    const content = "Foo foo FOO";
    expect(computeFileMatches(content, "foo", false)).toHaveLength(3);
    expect(computeFileMatches(content, "foo", true)).toHaveLength(1);
    expect(computeFileMatches(content, "foo", true)[0]).toMatchObject({ line: 1, column: 5 });
  });

  it("handles trailing content with no final newline", () => {
    const matches = computeFileMatches("x\ny\nz", "z", false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ line: 3, column: 1 });
    expect(matches[0].lineText).toBe("z");
  });

  it("counts multiple matches on the same line", () => {
    const matches = computeFileMatches("ab ab ab", "ab", false);
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.column)).toEqual([1, 4, 7]);
  });
});

describe("totalMatchCount", () => {
  it("sums matches across files", () => {
    const results = [
      { path: "a", matches: [{ line: 1, column: 1, lineText: "x", from: 0 }] },
      {
        path: "b",
        matches: [
          { line: 1, column: 1, lineText: "x", from: 0 },
          { line: 2, column: 3, lineText: "y", from: 2 },
        ],
      },
    ];
    expect(totalMatchCount(results)).toBe(3);
    expect(totalMatchCount([])).toBe(0);
  });
});
