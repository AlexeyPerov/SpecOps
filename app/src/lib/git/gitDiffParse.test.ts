import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./gitDiffParse";
import { DIFF_CONTEXT_LINES } from "./gitService";
import { describeIfGitInstalled, withTempGitRepo } from "./test/gitTempRepoHarness";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("parseUnifiedDiff", () => {
  it("parses a single-file patch with hunk boundaries and line counts", () => {
    const parsed = parseUnifiedDiff(readFixture("git-diff-unified-single-file.txt"));

    expect(parsed).toHaveLength(1);
    const diff = parsed[0]!;
    expect(diff.path).toBe("file.txt");
    expect(diff.isBinary).toBe(false);
    expect(diff.addedLines).toBe(2);
    expect(diff.deletedLines).toBe(1);
    expect(diff.newMode).toBe("100644");
    expect(diff.hunks).toHaveLength(1);

    const hunk = diff.hunks[0]!;
    expect(hunk.header).toBe("@@ -1,3 +1,4 @@");
    expect(hunk.lines[0]).toEqual({
      kind: "hunk-header",
      content: "@@ -1,3 +1,4 @@",
    });

    const added = hunk.lines.filter((line) => line.kind === "added");
    const deleted = hunk.lines.filter((line) => line.kind === "deleted");
    const context = hunk.lines.filter((line) => line.kind === "context");

    expect(added.map((line) => line.content)).toEqual(["line2 changed", "line4"]);
    expect(deleted.map((line) => line.content)).toEqual(["line2"]);
    expect(context.map((line) => line.content)).toEqual(["line1", "line3"]);
    expect(added.every((line) => line.newLineNo !== undefined)).toBe(true);
    expect(deleted.every((line) => line.oldLineNo !== undefined)).toBe(true);
  });

  it("marks binary patches without hunks", () => {
    const parsed = parseUnifiedDiff(readFixture("git-diff-binary.txt"));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      path: "image.png",
      oldPath: undefined,
      hunks: [],
      addedLines: 0,
      deletedLines: 0,
      isBinary: true,
      oldMode: undefined,
      newMode: "100644",
    });
  });

  it("returns one ParsedTextDiff per file in a multi-file patch", () => {
    const parsed = parseUnifiedDiff(readFixture("git-diff-multi-file.txt"));

    expect(parsed).toHaveLength(2);
    expect(parsed.map((diff) => diff.path)).toEqual(["a.txt", "b.txt"]);
    expect(parsed.every((diff) => diff.hunks)).toBe(true);
    expect(parsed[0]?.addedLines).toBe(1);
    expect(parsed[0]?.deletedLines).toBe(1);
    expect(parsed[1]?.addedLines).toBe(1);
    expect(parsed[1]?.deletedLines).toBe(1);
  });

  it("returns an empty list for blank stdout", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("   \n  ")).toEqual([]);
  });
});

describeIfGitInstalled("parseUnifiedDiff integration (temp repo harness)", () => {
  it("commit file change → git diff stdout → parser finds added line", () => {
    withTempGitRepo("specops-git-diff-parse-", (repo) => {
      repo.writeFile("tracked.txt", "before\n");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);
      const parentSha = (repo.run(["rev-parse", "HEAD"]) as string).trim();

      repo.writeFile("tracked.txt", "before\nafter\n");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "add line"]);
      const sha = (repo.run(["rev-parse", "HEAD"]) as string).trim();

      const stdout = repo.run([
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        `${parentSha}..${sha}`,
        "--",
        "tracked.txt",
      ]) as string;

      const parsed = parseUnifiedDiff(stdout);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]?.path).toBe("tracked.txt");
      expect(
        parsed[0]?.hunks
          .flatMap((hunk) => hunk.lines)
          .some((line) => line.kind === "added" && line.content === "after"),
      ).toBe(true);
    });
  });
});
