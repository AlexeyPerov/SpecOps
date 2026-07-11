import { describe, expect, it } from "vitest";
import { fuzzyRank, type FuzzyCandidate } from "./fuzzyRank";

function ids(matches: { item: string }[]): string[] {
  return matches.map((m) => m.item);
}

describe("fuzzyRank", () => {
  it("preserves caller ordering for an empty query", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "c", text: "charlie" },
      { item: "a", text: "alpha" },
      { item: "b", text: "bravo" },
    ];
    expect(ids(fuzzyRank(candidates, ""))).toEqual(["c", "a", "b"]);
    expect(ids(fuzzyRank(candidates, "   "))).toEqual(["c", "a", "b"]);
    expect(fuzzyRank(candidates, "")[0]?.ranges).toEqual([]);
  });

  it("is case insensitive", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "save", text: "Save File" },
      { item: "open", text: "Open File" },
    ];
    expect(ids(fuzzyRank(candidates, "SAVE"))).toEqual(["save"]);
    expect(ids(fuzzyRank(candidates, "oPeN"))).toEqual(["open"]);
  });

  it("prefers contiguous matches over scattered ones", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "scattered", text: "s_a_v_e_me" },
      { item: "contiguous", text: "save-document" },
    ];
    expect(ids(fuzzyRank(candidates, "save"))[0]).toBe("contiguous");
  });

  it("prefers word-boundary and label-start matches", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "mid", text: "unsaveable" },
      { item: "start", text: "SaveAll" },
      { item: "boundary", text: "File Save" },
    ];
    const ranked = ids(fuzzyRank(candidates, "save"));
    expect(ranked[0]).toBe("start");
    expect(ranked).toContain("boundary");
  });

  it("ranks path basenames ahead of directory-only hits", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "dir", text: "save/utils/helper.ts" },
      { item: "base", text: "src/save.ts" },
    ];
    expect(ids(fuzzyRank(candidates, "save"))[0]).toBe("base");
  });

  it("matches path separators flexibly via alt texts", () => {
    const candidates: FuzzyCandidate<string>[] = [
      {
        item: "file",
        text: "editorWorkbenchRuntime.ts",
        altTexts: ["app/src/lib/editor/editorWorkbenchRuntime.ts"],
      },
    ];
    expect(ids(fuzzyRank(candidates, "editor/workbench"))).toEqual(["file"]);
    expect(ids(fuzzyRank(candidates, "eWR"))).toEqual(["file"]);
  });

  it("supports acronym-style queries on camelCase labels", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "toggle", text: "toggleFindReplace" },
      { item: "other", text: "openWorkspaceManager" },
    ];
    expect(ids(fuzzyRank(candidates, "tfr"))).toEqual(["toggle"]);
  });

  it("matches command labels and search-term aliases", () => {
    const candidates: FuzzyCandidate<string>[] = [
      {
        item: "find",
        text: "Find / Replace",
        altTexts: ["search", "app.toggleFindReplace"],
      },
      { item: "goto", text: "Go To Line", altTexts: ["jump"] },
    ];
    expect(ids(fuzzyRank(candidates, "search"))).toEqual(["find"]);
    expect(ids(fuzzyRank(candidates, "jump"))).toEqual(["goto"]);
  });

  it("applies recentScore as a tie-break boost", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "old", text: "notes.md", recentScore: 0 },
      { item: "new", text: "notes.md", recentScore: 5 },
    ];
    // Same primary text → recent wins
    expect(ids(fuzzyRank(candidates, "notes"))[0]).toBe("new");
  });

  it("breaks remaining ties by original index (stable)", () => {
    const candidates: FuzzyCandidate<string>[] = [
      { item: "first", text: "alpha" },
      { item: "second", text: "alpha" },
      { item: "third", text: "alpha" },
    ];
    expect(ids(fuzzyRank(candidates, "alpha"))).toEqual(["first", "second", "third"]);
  });

  it("bounds returned results", () => {
    const candidates: FuzzyCandidate<string>[] = Array.from({ length: 20 }, (_, i) => ({
      item: `f${i}`,
      text: `file-${i}.ts`,
    }));
    expect(fuzzyRank(candidates, "file", { limit: 5 })).toHaveLength(5);
    expect(fuzzyRank(candidates, "", { limit: 3 })).toHaveLength(3);
    expect(fuzzyRank(candidates, "file", { limit: 0 })).toHaveLength(0);
  });

  it("returns match ranges on the primary text", () => {
    const [match] = fuzzyRank([{ item: "x", text: "SaveFile" }], "sf");
    expect(match?.ranges.length).toBeGreaterThan(0);
    for (const range of match?.ranges ?? []) {
      expect(range.start).toBeLessThan(range.end);
      expect(range.start).toBeGreaterThanOrEqual(0);
    }
  });

  it("contains no UI markup in scores or ranges", () => {
    const [match] = fuzzyRank([{ item: { id: 1 }, text: "Open" }], "op");
    expect(match).toEqual({
      item: { id: 1 },
      score: expect.any(Number),
      ranges: expect.any(Array),
    });
    expect(JSON.stringify(match)).not.toMatch(/<|>|span|mark|class=/i);
  });
});
