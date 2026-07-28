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

  it("strips CRLF line endings from fixture-style patches", () => {
    const crlf = readFixture("git-diff-unified-single-file.txt").replace(/\n/g, "\r\n");
    const parsed = parseUnifiedDiff(crlf);

    expect(parsed[0]?.hunks[0]?.header).toBe("@@ -1,3 +1,4 @@");
    expect(parsed[0]?.newMode).toBe("100644");

    const binaryCrlf = readFixture("git-diff-binary.txt").replace(/\n/g, "\r\n");
    expect(parseUnifiedDiff(binaryCrlf)[0]?.isBinary).toBe(true);
  });

  it("treats `--- `/`+++ ` body lines as content, not file headers (M8)", () => {
    // A hunk that adds SQL/Lua/Haskell-style `--` comments renders as body
    // lines starting with `+++ ` (added) / `--- ` (deleted). The parser must
    // not re-interpret them as the per-file old/new path headers, otherwise
    // `oldPath` is overwritten with comment text (making the file look
    // renamed) and the `+`/`-` count is corrupted.
    const stdout = [
      "diff --git a/script.sql b/script.sql",
      "index 1111111..2222222 100644",
      "--- a/script.sql",
      "+++ b/script.sql",
      "@@ -1,2 +1,4 @@",
      " -- existing comment",
      "+-- new comment one",
      "+-- new comment two that looks like +++ header",
      " -- trailing comment",
    ].join("\n");

    const parsed = parseUnifiedDiff(stdout);
    expect(parsed).toHaveLength(1);
    const diff = parsed[0]!;
    expect(diff.path).toBe("script.sql");
    expect(diff.oldPath).toBeUndefined();
    expect(diff.addedLines).toBe(2);
    expect(diff.deletedLines).toBe(0);
    expect(diff.isBinary).toBe(false);

    const hunk = diff.hunks[0]!;
    const addedContents = hunk.lines
      .filter((line) => line.kind === "added")
      .map((line) => line.content);
    expect(addedContents).toEqual([
      "-- new comment one",
      "-- new comment two that looks like +++ header",
    ]);
  });

  it("octal-decodes quoted non-ASCII diff-header paths (F20)", () => {
    // git quotes paths in every header when core.quotepath=true (the default),
    // emitting non-ASCII bytes as `\NNN` octal escapes. `caf\303\251.txt` is
    // `café.txt`. The previous parser only handled `[\\"nrt]`, so the parsed
    // path never matched the status path and the diff lookup threw.
    const stdout = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      "new file mode 100644",
      "index 0000000..3367afd",
      "--- /dev/null",
      '+++ "b/caf\\303\\251.txt"',
      "@@ -0,0 +1 @@",
      "+café",
    ].join("\n");

    const parsed = parseUnifiedDiff(stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.path).toBe("café.txt");
  });

  it("parses a binary diff whose path contains a space (F22)", () => {
    // git does not quote a path whose only special character is a space, so
    // `diff --git a/my img.png b/my img.png` has no `---`/`+++` lines to
    // recover the path from. The previous whitespace tokenizer split this
    // into four tokens and the lookup threw `GitCommitFileDiffNotFoundError`
    // instead of rendering the binary placeholder.
    const stdout = [
      "diff --git a/my img.png b/my img.png",
      "new file mode 100644",
      "index 0000000..0f49c4a",
      "Binary files /dev/null and b/my img.png differ",
    ].join("\n");

    const parsed = parseUnifiedDiff(stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.path).toBe("my img.png");
    expect(parsed[0]?.isBinary).toBe(true);
  });

  it("preserves a trailing space in an unquoted diff-header path (F23)", () => {
    // git appends a TAB to disambiguate an unquoted path that itself ends in a
    // space (`+++ b/trail.txt \t`). The previous `.trim()` ate the tab and the
    // significant trailing space, so the parsed path no longer matched the
    // status path.
    const stdout = [
      "diff --git a/trail.txt  b/trail.txt ",
      "index 1111111..2222222 100644",
      "--- a/trail.txt \t",
      "+++ b/trail.txt \t",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");

    const parsed = parseUnifiedDiff(stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.path).toBe("trail.txt ");
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
