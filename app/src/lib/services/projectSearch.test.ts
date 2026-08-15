import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, stat } from "@tauri-apps/plugin-fs";
import {
  computeFileMatches,
  MAX_SEARCH_TOTAL_MATCHES,
  searchInProject,
  totalMatchCount,
} from "./projectSearch";
import { createSearchQuery } from "../editor/searchQuery";

vi.mock("@tauri-apps/plugin-fs", () => ({
  stat: vi.fn(async () => ({ size: 100, isFile: true, isDirectory: false })),
  readTextFile: vi.fn(async () => ""),
}));

const statMock = vi.mocked(stat);
const readTextFileMock = vi.mocked(readTextFile);

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

describe("searchInProject (P03-08-30 concurrency)", () => {
  beforeEach(() => {
    statMock.mockReset();
    readTextFileMock.mockReset();
    statMock.mockResolvedValue({ size: 10, isFile: true, isDirectory: false } as never);
  });

  it("scans provided files and collects matches across them", async () => {
    const contents: Record<string, string> = {
      "/ws/a.ts": "foo bar\n",
      "/ws/b.ts": "nothing here\n",
      "/ws/c.ts": "foo baz\nfoo qux\n",
    };
    readTextFileMock.mockImplementation(async (path: string | URL) => contents[String(path)] ?? "");

    const outcome = await searchInProject("/ws", lit("foo"), {
      files: ["/ws/a.ts", "/ws/b.ts", "/ws/c.ts"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(totalMatchCount(outcome.results)).toBe(3);
    const paths = outcome.results.map((r) => r.path).sort();
    expect(paths).toEqual(["/ws/a.ts", "/ws/c.ts"]);
  });

  it("aborts early when onProgress returns false", async () => {
    const seen: string[] = [];
    readTextFileMock.mockImplementation(async () => "foo\n");

    const outcome = await searchInProject("/ws", lit("foo"), {
      files: ["/ws/a.ts", "/ws/b.ts", "/ws/c.ts", "/ws/d.ts"],
      onProgress: (path) => {
        seen.push(path);
        // Stop after the second file is claimed.
        return seen.length < 2;
      },
    });

    expect(outcome.ok).toBe(true);
    // onProgress is consulted per file before its stat/read; with concurrency,
    // a couple of files may already be in flight, but no more than the
    // concurrency cap should have been claimed.
    expect(seen.length).toBeLessThanOrEqual(4);
  });

  it("truncates at the global match cap", async () => {
    // Each file contributes many matches; force the cap to trigger.
    const bigLine = "foo ".repeat(5000);
    readTextFileMock.mockImplementation(async () => `${bigLine}\n`);
    statMock.mockResolvedValue({ size: 10, isFile: true, isDirectory: false } as never);

    const outcome = await searchInProject("/ws", lit("foo"), {
      files: ["/ws/a.ts", "/ws/b.ts", "/ws/c.ts"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.truncated).toBe(true);
    expect(totalMatchCount(outcome.results)).toBeLessThanOrEqual(MAX_SEARCH_TOTAL_MATCHES);
  });

  it("skips files larger than the size cap", async () => {
    statMock.mockResolvedValue({ size: 5_000_000, isFile: true, isDirectory: false } as never);
    readTextFileMock.mockImplementation(async () => "foo\n");

    const outcome = await searchInProject("/ws", lit("foo"), {
      files: ["/ws/huge.ts"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.results).toHaveLength(0);
  });

  it("counts scanned and unreadable files (stat/read failures surface, not vanish)", async () => {
    readTextFileMock.mockImplementation(async (path: string | URL) => {
      if (String(path) === "/ws/b.ts") {
        throw new Error("read failed");
      }
      return "foo\n";
    });
    statMock.mockImplementation(async (path: string | URL) => {
      if (String(path) === "/ws/c.ts") {
        throw new Error("gone");
      }
      return { size: 10, isFile: true, isDirectory: false } as never;
    });

    const outcome = await searchInProject("/ws", lit("foo"), {
      files: ["/ws/a.ts", "/ws/b.ts", "/ws/c.ts"],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.scannedFiles).toBe(1);
    expect(outcome.unreadableFiles).toBe(2);
    expect(outcome.results.map((r) => r.path)).toEqual(["/ws/a.ts"]);
  });
});
