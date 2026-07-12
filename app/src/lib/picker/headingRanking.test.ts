import { describe, expect, it } from "vitest";
import type { MarkdownHeadingSnapshot } from "../types/editor";
import { rankHeadings } from "./headingRanking";

function heading(
  text: string,
  level: number,
  line: number,
  overrides: Partial<MarkdownHeadingSnapshot> = {},
): MarkdownHeadingSnapshot {
  const from = overrides.from ?? line * 10;
  return {
    key: `${level}:${text}#0`,
    level,
    text,
    from,
    to: overrides.to ?? from + text.length,
    line,
  };
}

const SAMPLE: MarkdownHeadingSnapshot[] = [
  heading("Introduction", 1, 1),
  heading("Background", 2, 5),
  heading("Methods", 2, 12),
  heading("Results", 2, 20),
  heading("Discussion", 2, 30),
];

describe("rankHeadings — empty query", () => {
  it("preserves document order on an empty query", () => {
    const { matches } = rankHeadings(SAMPLE, "", 0);
    expect(matches.map((m) => m.heading.text)).toEqual([
      "Introduction",
      "Background",
      "Methods",
      "Results",
      "Discussion",
    ]);
  });

  it("marks the heading nearest the cursor as current", () => {
    // cursor at line 14 is under "Methods" (line 12)
    const methodsFrom = SAMPLE[2]!.from;
    const { matches } = rankHeadings(SAMPLE, "", methodsFrom + 1);
    expect(matches.find((m) => m.isCurrent)?.heading.text).toBe("Methods");
  });

  it("marks nothing current when cursor is before the first heading", () => {
    const { matches } = rankHeadings(SAMPLE, "", 0);
    expect(matches.every((m) => !m.isCurrent)).toBe(true);
  });

  it("exposes hierarchy + line metadata so duplicates stay distinguishable", () => {
    const { matches } = rankHeadings(SAMPLE, "", 0);
    expect(matches[1]?.hierarchyLabel).toBe("H2 · line 5");
  });
});

describe("rankHeadings — fuzzy query", () => {
  it("ranks matched headings by fuzzy score", () => {
    const { matches } = rankHeadings(SAMPLE, "res", 0);
    expect(matches.length).toBeGreaterThan(0);
    // "Results" matches the query prefix; "Discussion" contains "s".
    expect(matches[0]!.heading.text).toBe("Results");
  });

  it("drops non-matching headings", () => {
    const { matches } = rankHeadings(SAMPLE, "intro", 0);
    expect(matches.map((m) => m.heading.text)).toEqual(["Introduction"]);
  });

  it("keeps duplicates distinguishable by hierarchy/line metadata", () => {
    const duplicates = [
      heading("Notes", 2, 3),
      heading("Notes", 3, 40),
    ];
    const { matches } = rankHeadings(duplicates, "notes", 0);
    expect(matches.map((m) => m.heading.line)).toEqual([3, 40]);
    expect(new Set(matches.map((m) => m.hierarchyLabel)).size).toBe(2);
  });

  it("reports scan/total/truncated metadata", () => {
    const full = rankHeadings(SAMPLE, "s", 0);
    expect(full.scannedCount).toBe(5);
    expect(full.totalMatches).toBe(full.matches.length);
    expect(full.truncated).toBe(false);

    const bounded = rankHeadings(SAMPLE, "", 0, { limit: 2 });
    expect(bounded.matches.length).toBe(2);
    expect(bounded.totalMatches).toBe(5);
    expect(bounded.truncated).toBe(true);
  });
});

describe("rankHeadings — tie-breaks", () => {
  it("breaks ties by proximity to the cursor (closer first)", () => {
    // Two equal headings matching "x"; the one nearer the active cursor wins.
    const headings = [
      heading("Section X", 2, 4),
      heading("Section X", 2, 60),
    ];
    // Cursor near line 60 → second should rank first.
    const farFrom = headings[1]!.from;
    const { matches } = rankHeadings(headings, "section x", farFrom - 1);
    expect(matches[0]!.heading.line).toBe(60);
  });
});
