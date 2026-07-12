import { describe, expect, it } from "vitest";
import {
  activeMarkdownHeading,
  extractMarkdownHeadingsFromText,
  filterMarkdownHeadings,
} from "./markdownHeadings";

describe("extractMarkdownHeadingsFromText", () => {
  it("extracts nested ATX headings with stable keys", () => {
    const headings = extractMarkdownHeadingsFromText(
      "# Title\n\n## One\n\ntext\n\n## Two\n\n### Nested\n\n# Again\n",
    );
    expect(headings.map((h) => ({ level: h.level, text: h.text, key: h.key }))).toEqual([
      { level: 1, text: "Title", key: "1:Title#0" },
      { level: 2, text: "One", key: "2:One#0" },
      { level: 2, text: "Two", key: "2:Two#0" },
      { level: 3, text: "Nested", key: "3:Nested#0" },
      { level: 1, text: "Again", key: "1:Again#0" },
    ]);
  });

  it("supports duplicate heading texts with ordinal keys", () => {
    const headings = extractMarkdownHeadingsFromText("# Dup\n\n## X\n\n# Dup\n");
    expect(headings.map((h) => h.key)).toEqual(["1:Dup#0", "2:X#0", "1:Dup#1"]);
  });

  it("extracts setext headings", () => {
    const headings = extractMarkdownHeadingsFromText("Title\n=====\n\nSubtitle\n-------\n");
    expect(headings.map((h) => ({ level: h.level, text: h.text }))).toEqual([
      { level: 1, text: "Title" },
      { level: 2, text: "Subtitle" },
    ]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const headings = extractMarkdownHeadingsFromText(
      "# Real\n\n```md\n# Fake\n```\n\n## Also real\n",
    );
    expect(headings.map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("returns empty for empty documents", () => {
    expect(extractMarkdownHeadingsFromText("")).toEqual([]);
    expect(extractMarkdownHeadingsFromText("no headings here\n")).toEqual([]);
  });

  it("tracks active heading by cursor position", () => {
    const text = "# A\n\npara\n\n## B\n\nmore\n";
    const headings = extractMarkdownHeadingsFromText(text);
    const afterA = text.indexOf("para");
    const afterB = text.indexOf("more");
    expect(activeMarkdownHeading(headings, afterA)?.text).toBe("A");
    expect(activeMarkdownHeading(headings, afterB)?.text).toBe("B");
  });

  it("filters by case-insensitive substring", () => {
    const headings = extractMarkdownHeadingsFromText("# Alpha\n\n## Beta\n\n# Alphabet\n");
    expect(filterMarkdownHeadings(headings, "alp").map((h) => h.text)).toEqual([
      "Alpha",
      "Alphabet",
    ]);
  });
});

describe("extractMarkdownHeadings scale", () => {
  it("stays responsive for 2000 synthetic headings", () => {
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const level = (i % 6) + 1;
      lines.push(`${"#".repeat(level)} Heading ${i}`);
      lines.push("");
    }
    const text = lines.join("\n");
    const started = performance.now();
    const headings = extractMarkdownHeadingsFromText(text);
    const elapsed = performance.now() - started;
    expect(headings).toHaveLength(2000);
    // Agreed budget: under 1.5s in CI/jsdom (typically far lower).
    expect(elapsed).toBeLessThan(1500);
  });
});
