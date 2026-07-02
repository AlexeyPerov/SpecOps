import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLogCommitLine } from "./gitParse";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("parseLogCommitLine", () => {
  it("parses a single structured commit line from fixtures", () => {
    const stdout = readFixture("git-log-format.txt");
    const line = stdout.split("\n").find((entry) => entry.trim().length > 0);
    expect(line).toBeDefined();

    const commit = parseLogCommitLine(line!);

    expect(commit).toEqual({
      sha: "fe3fcdbb69181a9771325f0a0afa029c398d1c71",
      parents: ["0154eaa2f004272865fa126a459a87460d902f0c"],
      decorators: "tag: refs/tags/v1.0.0, refs/heads/feature/login",
      authorName: "Dev User",
      authorEmail: "dev@example.com",
      authorTime: 1783000834,
      committerName: "Dev User",
      committerEmail: "dev@example.com",
      committerTime: 1783000834,
      subject: "Add login flow",
    });
  });

  it("returns null when the line does not have eight NUL-separated fields", () => {
    expect(parseLogCommitLine("incomplete")).toBeNull();
  });
});

describe("fixture files", () => {
  it("documents git commands in README and provides non-empty stdout samples", () => {
    const readme = readFixture("README.md");
    expect(readme).toContain("git log --no-show-signature");
    expect(readme).toContain("git branch -vv");
    expect(readme).toContain("git tag -l");
    expect(readme).toContain("git status --porcelain");

    expect(readFixture("git-log-format.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-branch-vv.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-tag-list.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-status-porcelain.txt").trim().length).toBeGreaterThan(0);
  });
});
