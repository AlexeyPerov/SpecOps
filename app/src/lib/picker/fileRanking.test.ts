import { describe, expect, it } from "vitest";
import { rankFiles, recentFileOrder, type RankedFile } from "./fileRanking";
import type { WorkspaceFileEntry } from "../services/workspaceFileCatalog";

function entry(relativePath: string, root = "/ws"): WorkspaceFileEntry {
  const absolutePath = `${root}/${relativePath}`;
  const slash = relativePath.lastIndexOf("/");
  const basename = slash >= 0 ? relativePath.slice(slash + 1) : relativePath;
  const directoryAbs = slash >= 0 ? `${root}/${relativePath.slice(0, slash)}` : root;
  return {
    absolutePath,
    relativePath,
    basename,
    directory: directoryAbs,
    key: absolutePath,
  };
}

function snapshot(entries: WorkspaceFileEntry[]) {
  return { entries, status: "ready" as const };
}

function paths(matches: RankedFile[]): string[] {
  return matches.map((m) => m.entry.relativePath);
}

describe("rankFiles", () => {
  it("returns empty matches for an empty catalog", () => {
    const result = rankFiles(snapshot([]), "anything");
    expect(result.matches).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.scannedCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("ranks basename matches ahead of equivalent directory-only matches", () => {
    const entries = [
      entry("save/utils/helper.ts"),
      entry("src/save.ts"),
      entry("docs/saving/notes.md"),
    ];
    const ranked = rankFiles(snapshot(entries), "save");
    expect(ranked.matches[0]!.entry.relativePath).toBe("src/save.ts");
    // Directory-only match (docs/saving) should rank below basename matches.
    expect(ranked.matches[1]!.entry.relativePath).toBe("save/utils/helper.ts");
  });

  it("handles duplicate basenames in different directories deterministically", () => {
    const entries = [
      entry("src/index.ts"),
      entry("lib/index.ts"),
      entry("app/index.ts"),
    ];
    const ranked = rankFiles(snapshot(entries), "index");
    expect(ranked.matches).toHaveLength(3);
    // All three match; stable ordering by score then original index.
    const relatives = paths(ranked.matches);
    expect(relatives).toContain("src/index.ts");
    expect(relatives).toContain("lib/index.ts");
    expect(relatives).toContain("app/index.ts");
  });

  it("matches nested paths via alt texts (separator-insensitive queries)", () => {
    const entries = [entry("src/components/Button.svelte")];
    // Query with path separators / camelCase should still match via altTexts.
    const ranked = rankFiles(snapshot(entries), "components/button");
    expect(ranked.matches).toHaveLength(1);
    expect(ranked.matches[0]!.entry.relativePath).toBe("src/components/Button.svelte");
    // Alt-text-only matches produce no highlight ranges.
    expect(ranked.matches[0]!.ranges).toEqual([]);
  });

  it("ranks exact basename matches above prefix-only basename matches", () => {
    // "readme" (exact basename) should outrank "readme-long" (prefix only).
    const entries = [
      entry("a/readme-long"),
      entry("readme"),
    ];
    const ranked = rankFiles(snapshot(entries), "readme");
    expect(ranked.matches[0]!.entry.relativePath).toBe("readme");
  });

  it("boosts open files above recent files above catalog-only entries on empty query", () => {
    const entries = [
      entry("alpha.ts"),
      entry("beta.ts"),
      entry("gamma.ts"),
      entry("delta.ts"),
    ];
    const result = rankFiles(snapshot(entries), "", {
      openPaths: [`${"/ws"}/gamma.ts`],
      recentPaths: [`${"/ws"}/alpha.ts`, `${"/ws"}/delta.ts`],
    });
    const relatives = paths(result.matches);
    expect(relatives[0]).toBe("gamma.ts"); // open
    expect(relatives[1]).toBe("alpha.ts"); // recent (most recent)
    expect(relatives[2]).toBe("delta.ts"); // recent (second)
    expect(relatives[3]).toBe("beta.ts"); // catalog only
    expect(result.matches[0]!.recency).toBe("open");
    expect(result.matches[1]!.recency).toBe("recent");
    expect(result.matches[3]!.recency).toBeNull();
  });

  it("preserves caller order for catalog-only entries on empty query", () => {
    const entries = [entry("zeta.ts"), entry("alpha.ts"), entry("mu.ts")];
    const result = rankFiles(snapshot(entries), "");
    expect(paths(result.matches)).toEqual(["zeta.ts", "alpha.ts", "mu.ts"]);
    expect(result.matches.every((m) => m.recency === null)).toBe(true);
    expect(result.matches.every((m) => m.score === 0)).toBe(true);
    expect(result.matches.every((m) => m.ranges.length === 0)).toBe(true);
  });

  it("boosts recent files during fuzzy matching via recency tie-break", () => {
    const entries = [entry("a/app.ts"), entry("b/app.ts")];
    // Two identical basename matches; the recent one should win.
    const ranked = rankFiles(snapshot(entries), "app", {
      recentPaths: [`${"/ws"}/b/app.ts`],
    });
    expect(ranked.matches[0]!.entry.relativePath).toBe("b/app.ts");
    expect(ranked.matches[0]!.recency).toBe("recent");
  });

  it("deduplicates entries with the same normalized key", () => {
    const dup = entry("src/a.ts");
    const entries = [dup, { ...dup }, entry("src/b.ts")];
    const result = rankFiles(snapshot(entries), "");
    expect(result.scannedCount).toBe(2);
    expect(result.matches).toHaveLength(2);
  });

  it("bounds displayed results and reports total match metadata", () => {
    const entries: WorkspaceFileEntry[] = [];
    for (let i = 0; i < 50; i += 1) {
      entries.push(entry(`f${i}.ts`));
    }
    const result = rankFiles(snapshot(entries), "f", { limit: 10 });
    expect(result.matches).toHaveLength(10);
    expect(result.totalMatches).toBe(50);
    expect(result.scannedCount).toBe(50);
    expect(result.truncated).toBe(true);
  });

  it("reports status and scannedCount from the snapshot", () => {
    const entries = [entry("a.ts")];
    const loading = rankFiles({ entries, status: "loading" }, "a");
    expect(loading.status).toBe("loading");
    expect(loading.scannedCount).toBe(1);
  });

  it("ranks 10,000 synthetic entries within a performance budget", () => {
    const entries: WorkspaceFileEntry[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      entries.push(entry(`pkg/mod${i}/file${i}.ts`));
    }
    const start = performance.now();
    // Use a common substring so a meaningful subset matches at scale.
    const result = rankFiles(snapshot(entries), "file", { limit: 50 });
    const duration = performance.now() - start;
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.length).toBeLessThanOrEqual(50);
    expect(result.totalMatches).toBe(10_000);
    expect(result.scannedCount).toBe(10_000);
    expect(result.truncated).toBe(true);
    // Generous budget: ranking 10k entries must stay well under 500ms in tests.
    expect(duration).toBeLessThan(500);
  });

  it("handles empty query with limit truncating the recency-ordered set", () => {
    const entries: WorkspaceFileEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      entries.push(entry(`f${i}.ts`));
    }
    const result = rankFiles(snapshot(entries), "", { limit: 5 });
    expect(result.matches).toHaveLength(5);
    expect(result.totalMatches).toBe(30);
    expect(result.truncated).toBe(true);
  });
});

describe("recentFileOrder", () => {
  it("orders open, recent, then catalog-only entries without fuzzy scoring", () => {
    const entries = [entry("a.ts"), entry("b.ts"), entry("c.ts"), entry("d.ts")];
    const ordered = recentFileOrder(entries, {
      openPaths: ["/ws/c.ts"],
      recentPaths: ["/ws/a.ts"],
    });
    expect(ordered.map((e) => e.relativePath)).toEqual(["c.ts", "a.ts", "b.ts", "d.ts"]);
  });
});
