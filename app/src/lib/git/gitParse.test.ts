import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GIT_LOG_FORMAT } from "./gitParse";
import {
  parseAheadBehindCount,
  parseBranchShowCurrent,
  parseBranchVvLine,
  parseBranchVvLines,
  parseCommitDecorators,
  parseCommitShow,
  parseLogCommitLine,
  parseLogCommits,
  parseShortHeadRef,
  parseUpstreamRef,
  GIT_SHOW_FORMAT,
} from "./gitParse";

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
      decoratorsRaw: "tag: refs/tags/v1.0.0, refs/heads/feature/login",
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

describe("parseCommitDecorators", () => {
  it("parses tag and local branch refs", () => {
    expect(parseCommitDecorators("tag: refs/tags/v1.0.0, refs/heads/feature/login")).toEqual([
      { type: "localBranchHead", name: "feature/login" },
      { type: "tag", name: "v1.0.0" },
    ]);
  });

  it("parses current branch HEAD decoration", () => {
    expect(parseCommitDecorators("HEAD -> refs/heads/master")).toEqual([
      { type: "currentBranchHead", name: "master" },
    ]);
  });

  it("parses remote branch refs and skips /HEAD aliases", () => {
    expect(
      parseCommitDecorators("refs/remotes/origin/main, refs/remotes/origin/HEAD"),
    ).toEqual([{ type: "remoteBranchHead", name: "origin/main" }]);
  });

  it("returns an empty list for blank decorator fields", () => {
    expect(parseCommitDecorators("")).toEqual([]);
    expect(parseCommitDecorators("  ")).toEqual([]);
  });
});

describe("parseLogCommits", () => {
  it("parses all fixture commits in stdout order (newest first)", () => {
    const commits = parseLogCommits(readFixture("git-log-format.txt"));

    expect(commits).toHaveLength(2);
    expect(commits[0]?.sha).toBe("fe3fcdbb69181a9771325f0a0afa029c398d1c71");
    expect(commits[0]?.refs).toEqual([
      { type: "localBranchHead", name: "feature/login" },
      { type: "tag", name: "v1.0.0" },
    ]);
    expect(commits[1]?.sha).toBe("0154eaa2f004272865fa126a459a87460d902f0c");
    expect(commits[1]?.refs).toEqual([{ type: "currentBranchHead", name: "master" }]);
    expect(commits[1]?.subject).toBe("Initial commit");
  });
});

describe("parseLogCommits integration", () => {
  it("parses real git log output from a temp repository newest-first", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "specops-git-log-"));
    try {
      execSync("git init", { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.name "Test User"', { cwd: repoDir, stdio: "pipe" });

      writeFileSync(join(repoDir, "file.txt"), "first");
      execSync("git add file.txt", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -m "First commit"', { cwd: repoDir, stdio: "pipe" });

      writeFileSync(join(repoDir, "file.txt"), "second");
      execSync("git add file.txt", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -m "Second commit"', { cwd: repoDir, stdio: "pipe" });
      execSync("git tag v1.0", { cwd: repoDir, stdio: "pipe" });

      const stdout = execSync(
        `git log --no-show-signature --decorate=full --format=${JSON.stringify(GIT_LOG_FORMAT)} -2`,
        { cwd: repoDir, encoding: "utf8" },
      );

      const commits = parseLogCommits(stdout);

      expect(commits).toHaveLength(2);
      expect(commits[0]?.subject).toBe("Second commit");
      expect(commits[1]?.subject).toBe("First commit");
      expect(commits[0]?.refs.some((ref) => ref.type === "tag" && ref.name === "v1.0")).toBe(true);
      expect(commits[0]?.refs.some((ref) => ref.type === "currentBranchHead")).toBe(true);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("parseBranchShowCurrent", () => {
  it("returns the branch name when stdout is non-empty", () => {
    expect(parseBranchShowCurrent("main\n")).toBe("main");
    expect(parseBranchShowCurrent("feature/login")).toBe("feature/login");
  });

  it("returns null for empty stdout (detached HEAD)", () => {
    expect(parseBranchShowCurrent("")).toBeNull();
    expect(parseBranchShowCurrent("\n")).toBeNull();
    expect(parseBranchShowCurrent("   \n")).toBeNull();
  });
});

describe("parseShortHeadRef", () => {
  it("trims short SHA output", () => {
    expect(parseShortHeadRef("a6074434\n")).toBe("a6074434");
  });
});

describe("parseUpstreamRef", () => {
  it("returns upstream ref when present", () => {
    expect(parseUpstreamRef("origin/main\n")).toBe("origin/main");
    expect(parseUpstreamRef("master")).toBe("master");
  });

  it("returns null when upstream is missing or unresolved", () => {
    expect(parseUpstreamRef("")).toBeNull();
    expect(parseUpstreamRef("HEAD")).toBeNull();
    expect(parseUpstreamRef("\n")).toBeNull();
  });
});

describe("parseAheadBehindCount", () => {
  it("parses tab-separated behind and ahead counts", () => {
    expect(parseAheadBehindCount("2\t3\n")).toEqual({ behind: 2, ahead: 3 });
    expect(parseAheadBehindCount("0\t0")).toEqual({ behind: 0, ahead: 0 });
  });

  it("returns null for malformed stdout", () => {
    expect(parseAheadBehindCount("")).toBeNull();
    expect(parseAheadBehindCount("ahead 2")).toBeNull();
  });
});

describe("parseBranchVvLine", () => {
  it("parses fixture branch rows with current marker and subject", () => {
    const lines = readFixture("git-branch-vv.txt").split("\n").filter(Boolean);

    expect(parseBranchVvLine(lines[0]!)).toEqual({
      isCurrent: false,
      name: "feature/login",
      head: "fe3fcdb",
      upstream: null,
      upstreamTrack: null,
      subject: "Add login flow",
    });
    expect(parseBranchVvLine(lines[1]!)).toEqual({
      isCurrent: true,
      name: "master",
      head: "0154eaa",
      upstream: null,
      upstreamTrack: null,
      subject: "Initial commit",
    });
  });

  it("parses upstream and tracking info from brackets", () => {
    expect(
      parseBranchVvLine("* main abc1234 [origin/main: ahead 2, behind 1] Latest commit"),
    ).toEqual({
      isCurrent: true,
      name: "main",
      head: "abc1234",
      upstream: "origin/main",
      upstreamTrack: "ahead 2, behind 1",
      subject: "Latest commit",
    });
  });
});

describe("parseBranchVvLines", () => {
  it("parses all fixture branches and flags the current branch", () => {
    const branches = parseBranchVvLines(readFixture("git-branch-vv.txt"));

    expect(branches).toHaveLength(2);
    expect(branches.find((branch) => branch.isCurrent)?.name).toBe("master");
    expect(branches.find((branch) => branch.name === "feature/login")?.isCurrent).toBe(false);
  });
});

describe("parseCommitShow", () => {
  it("parses metadata and name-status file rows from fixture stdout", () => {
    const detail = parseCommitShow(readFixture("git-show-name-status.txt"));

    expect(detail).not.toBeNull();
    expect(detail?.sha).toBe("b15c01ba9a549a389363b7c6565d839973977239");
    expect(detail?.parents).toEqual(["56382141a5939d37907cdb8a363c79e52ed6583d"]);
    expect(detail?.authorName).toBe("Alexey Perov");
    expect(detail?.authorEmail).toBe("a.perov@zmeke.com");
    expect(detail?.committerName).toBe("GitHub");
    expect(detail?.message).toContain("feat(git): add commit log query and parser (Task 2.2)");
    expect(detail?.files.length).toBeGreaterThan(0);
    expect(detail?.files.every((file) => file.status === "M")).toBe(true);
    expect(detail?.files.some((file) => file.path.endsWith("gitParse.ts"))).toBe(true);
  });

  it("parses rename rows with previous and new paths", () => {
    const stdout =
      "abc123\x00\x00Author\x00author@example.com\x001700000000\x00Author\x00author@example.com\x001700000000\x00Rename commit\n\nR100\told/path.ts\tnew/path.ts\n";
    const detail = parseCommitShow(stdout);

    expect(detail?.files).toEqual([
      {
        status: "R",
        previousPath: "old/path.ts",
        path: "new/path.ts",
      },
    ]);
  });
});

describe("parseCommitShow integration", () => {
  it("parses real git show output from a temp repository", () => {
    const repoDir = mkdtempSync(join(tmpdir(), "specops-git-show-"));
    try {
      execSync("git init", { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.name "Test User"', { cwd: repoDir, stdio: "pipe" });

      writeFileSync(join(repoDir, "added.txt"), "new");
      execSync("git add added.txt", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -m "Add file"', { cwd: repoDir, stdio: "pipe" });

      const stdout = execSync(
        `git show --name-status --format=${JSON.stringify(GIT_SHOW_FORMAT)} HEAD`,
        { cwd: repoDir, encoding: "buffer" },
      );

      const detail = parseCommitShow(stdout.toString("utf8"));

      expect(detail?.message).toContain("Add file");
      expect(detail?.files).toEqual([{ status: "A", path: "added.txt" }]);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

describe("fixture files", () => {
  it("documents git commands in README and provides non-empty stdout samples", () => {
    const readme = readFixture("README.md");
    expect(readme).toContain("git log --no-show-signature");
    expect(readme).toContain("git branch -vv");
    expect(readme).toContain("git tag -l");
    expect(readme).toContain("git status --porcelain");
    expect(readme).toContain("git show --name-status");

    expect(readFixture("git-log-format.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-branch-vv.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-show-name-status.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-tag-list.txt").trim().length).toBeGreaterThan(0);
    expect(readFixture("git-status-porcelain.txt").trim().length).toBeGreaterThan(0);
  });
});
