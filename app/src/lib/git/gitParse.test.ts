import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeIfGitInstalled, withTempGitRepo } from "./test/gitTempRepoHarness";
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
  parseLsRemoteTags,
  parseRemoteVvLines,
  mergeTagRemotePresence,
  resolveDefaultRemote,
  parseShortHeadRef,
  parseStatusPorcelain,
  parseStatusPorcelainV2Z,
  parseStatusShortBranchHeader,
  parseStashList,
  parseStashListItem,
  parseTagList,
  splitWorkingTreeStatus,
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

describeIfGitInstalled("parseLogCommits integration", () => {
  it("parses real git log output from a temp repository newest-first", () => {
    withTempGitRepo("specops-git-log-", (repo) => {
      repo.writeFile("file.txt", "first");
      repo.run(["add", "file.txt"]);
      repo.run(["commit", "-m", "First commit"]);

      repo.writeFile("file.txt", "second");
      repo.run(["add", "file.txt"]);
      repo.run(["commit", "-m", "Second commit"]);
      repo.run(["tag", "v1.0"]);

      const stdout = repo.run([
        "log",
        "--no-show-signature",
        "--decorate=full",
        `--format=${GIT_LOG_FORMAT}`,
        "-2",
      ]) as string;

      const commits = parseLogCommits(stdout);

      expect(commits).toHaveLength(2);
      expect(commits[0]?.subject).toBe("Second commit");
      expect(commits[1]?.subject).toBe("First commit");
      expect(commits[0]?.refs.some((ref) => ref.type === "tag" && ref.name === "v1.0")).toBe(true);
      expect(commits[0]?.refs.some((ref) => ref.type === "currentBranchHead")).toBe(true);
    });
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

describe("parseStatusShortBranchHeader", () => {
  it("parses tracked branch with ahead/behind counts", () => {
    expect(parseStatusShortBranchHeader("## main...origin/main [ahead 2, behind 1]")).toEqual({
      branchName: "main",
      isDetached: false,
      upstream: "origin/main",
      aheadBehind: { ahead: 2, behind: 1 },
    });
  });

  it("parses branch without tracking counts", () => {
    expect(parseStatusShortBranchHeader("## main...origin/main")).toEqual({
      branchName: "main",
      isDetached: false,
      upstream: "origin/main",
      aheadBehind: null,
    });
  });

  it("parses local branch without upstream", () => {
    expect(parseStatusShortBranchHeader("## feature")).toEqual({
      branchName: "feature",
      isDetached: false,
      upstream: null,
      aheadBehind: null,
    });
  });

  it("parses detached HEAD marker", () => {
    expect(parseStatusShortBranchHeader("## HEAD (no branch)")).toEqual({
      branchName: "",
      isDetached: true,
      upstream: null,
      aheadBehind: null,
    });
  });

  it("parses gone upstream marker without counts", () => {
    expect(parseStatusShortBranchHeader("## main...origin/main [gone]")).toEqual({
      branchName: "main",
      isDetached: false,
      upstream: "origin/main",
      aheadBehind: null,
    });
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

  it("parses branch names with slashes, symbols, and spaces outside app validation", () => {
    expect(
      parseBranchVvLine("  feature/weird@name#1 abc1234 [origin/x: gone] Fix things"),
    ).toEqual({
      isCurrent: false,
      name: "feature/weird@name#1",
      head: "abc1234",
      upstream: "origin/x",
      upstreamTrack: "gone",
      subject: "Fix things",
    });
    expect(parseBranchVvLine("* release 2024-q1 deadbeef0 Release prep")).toEqual({
      isCurrent: true,
      name: "release 2024-q1",
      head: "deadbeef0",
      upstream: null,
      upstreamTrack: null,
      subject: "Release prep",
    });
    expect(parseBranchVvLine("  .hidden-branch 0123456")).toEqual({
      isCurrent: false,
      name: ".hidden-branch",
      head: "0123456",
      upstream: null,
      upstreamTrack: null,
      subject: "",
    });
  });
});

describe("parseBranchVvLines", () => {
  it("parses all fixture branches and flags the current branch", () => {
    const branches = parseBranchVvLines(readFixture("git-branch-vv.txt"));

    expect(branches).toHaveLength(4);
    expect(branches.find((branch) => branch.isCurrent)?.name).toBe("master");
    expect(branches.find((branch) => branch.name === "feature/login")?.isCurrent).toBe(false);
    expect(branches.find((branch) => branch.name === "release 2024-q1")?.head).toBe("deadbeef0");
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

  it("normalizes Windows backslashes in name-status paths", () => {
    const stdout =
      "abc123\x00\x00Author\x00author@example.com\x001700000000\x00Author\x00author@example.com\x001700000000\x00Rename commit\n\nR100\told\\path.ts\tnew\\path.ts\nM\tsrc\\components\\App.svelte\n";
    const detail = parseCommitShow(stdout);

    expect(detail?.files).toEqual([
      {
        status: "R",
        previousPath: "old/path.ts",
        path: "new/path.ts",
      },
      {
        status: "M",
        path: "src/components/App.svelte",
      },
    ]);
  });

  it("decodes octal-quoted non-ASCII paths in name-status lines", () => {
    const stdout =
      'abc123\x00\x00Author\x00author@example.com\x001700000000\x00Author\x00author@example.com\x001700000000\x00Unicode paths\n\nA\t"nested/caf\\303\\251.txt"\nA\tspaces file.txt\n';
    const detail = parseCommitShow(stdout);

    expect(detail?.files.map((file) => file.path).sort()).toEqual([
      "nested/café.txt",
      "spaces file.txt",
    ]);
  });
});

describe("parseTagList", () => {
  it("parses fixture tag names sorted alphabetically", () => {
    expect(parseTagList(readFixture("git-tag-list.txt"))).toEqual(["v1.0.0"]);
  });

  it("sorts tags alphabetically regardless of git output order", () => {
    expect(parseTagList("v2.0.0\nalpha\nv1.0.0\nbeta\n")).toEqual([
      "alpha",
      "beta",
      "v1.0.0",
      "v2.0.0",
    ]);
  });

  it("returns an empty list for blank stdout", () => {
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList("\n\n")).toEqual([]);
  });
});

describe("parseStashList", () => {
  it("parses fixture stash rows in stable newest-first order", () => {
    expect(parseStashList(readFixture("git-stash-list-z.txt"))).toEqual([
      {
        sha: "abc1111111111111111111111111111111111111111",
        parents: ["def2222222222222222222222222222222222222222"],
        ref: "stash@{0}",
        createdAt: 1_700_000_000,
        message: "WIP on main: first stash",
      },
      {
        sha: "0000000000000000000000000000000000000000",
        parents: ["fed3333333333333333333333333333333333333333"],
        ref: "stash@{1}",
        createdAt: 1_699_900_000,
        message: "On feature: second stash with\nmultiple message lines",
      },
    ]);
  });

  it("returns an empty list for blank stdout", () => {
    expect(parseStashList("")).toEqual([]);
    expect(parseStashList("\n\n")).toEqual([]);
  });

  it("skips malformed stash entries without throwing", () => {
    expect(parseStashList("only-one-line\n\0")).toEqual([]);
    expect(parseStashList("abc\n\0valid-ish\n")).toEqual([]);
  });
});

describe("parseStashListItem", () => {
  it("returns null for incomplete field sets", () => {
    expect(parseStashListItem("abc123\nparent\n")).toBeNull();
    expect(parseStashListItem("")).toBeNull();
  });
});

describe("parseRemoteVvLines", () => {
  it("parses fixture remotes with distinct fetch and push URLs", () => {
    expect(parseRemoteVvLines(readFixture("git-remote-vv.txt"))).toEqual([
      {
        name: "origin",
        fetchUrl: "https://github.com/example/specops.git",
        pushUrl: "https://github.com/example/specops.git",
      },
      {
        name: "upstream",
        fetchUrl: "https://github.com/example/upstream.git",
        pushUrl: "git@github.com:example/upstream-push.git",
      },
    ]);
  });

  it("returns an empty list for blank stdout", () => {
    expect(parseRemoteVvLines("")).toEqual([]);
    expect(parseRemoteVvLines("\n\n")).toEqual([]);
  });
});

describe("parseLsRemoteTags", () => {
  it("parses fixture tag names and dedupes peeled object lines", () => {
    expect(parseLsRemoteTags(readFixture("git-ls-remote-tags.txt"))).toEqual([
      "v1.0.0",
      "v2.0.0",
    ]);
  });

  it("returns an empty list for blank stdout", () => {
    expect(parseLsRemoteTags("")).toEqual([]);
  });
});

describe("resolveDefaultRemote", () => {
  it("prefers origin when present", () => {
    const remotes = [
      { name: "upstream", fetchUrl: "a", pushUrl: "a" },
      { name: "origin", fetchUrl: "b", pushUrl: "b" },
    ];
    expect(resolveDefaultRemote(remotes)?.name).toBe("origin");
  });

  it("falls back to the first remote when origin is missing", () => {
    const remotes = [{ name: "upstream", fetchUrl: "a", pushUrl: "a" }];
    expect(resolveDefaultRemote(remotes)?.name).toBe("upstream");
  });
});

describe("mergeTagRemotePresence", () => {
  it("marks tags present on the default remote", () => {
    expect(mergeTagRemotePresence(["alpha", "beta"], ["beta"])).toEqual([
      { name: "alpha" },
      { name: "beta", onRemote: true },
    ]);
  });
});

describeIfGitInstalled("parseCommitShow integration", () => {
  it("parses real git show output from a temp repository", () => {
    withTempGitRepo("specops-git-show-", (repo) => {
      repo.writeFile("added.txt", "new");
      repo.run(["add", "added.txt"]);
      repo.run(["commit", "-m", "Add file"]);

      const stdout = repo.run([
        "show",
        "--name-status",
        `--format=${GIT_SHOW_FORMAT}`,
        "HEAD",
      ]) as string;

      const detail = parseCommitShow(stdout);

      expect(detail?.message).toContain("Add file");
      expect(detail?.files).toEqual([{ status: "A", path: "added.txt" }]);
    });
  });
});

describe("parseStatusPorcelain", () => {
  it("parses modified and untracked fixture lines", () => {
    const lines = parseStatusPorcelain(readFixture("git-status-porcelain.txt"));

    expect(lines.some((line) => line.path === "README.md" && line.workTreeStatus === "M")).toBe(
      true,
    );
    expect(lines.some((line) => line.path === "untracked.txt")).toBe(true);
    expect(lines.find((line) => line.path === "untracked.txt")).toEqual({
      indexStatus: "?",
      workTreeStatus: "?",
      path: "untracked.txt",
    });
  });

  it("parses staged-only, both-staged-unstaged, and rename arrow paths", () => {
    const lines = parseStatusPorcelain(readFixture("git-status-porcelain.txt"));

    expect(lines.find((line) => line.path === "staged-only.txt")).toEqual({
      indexStatus: "M",
      workTreeStatus: " ",
      path: "staged-only.txt",
    });
    expect(lines.find((line) => line.path === "both-staged-unstaged.txt")).toEqual({
      indexStatus: "M",
      workTreeStatus: "M",
      path: "both-staged-unstaged.txt",
    });
    expect(lines.find((line) => line.path === "new-name.txt")).toEqual({
      indexStatus: "R",
      workTreeStatus: " ",
      path: "new-name.txt",
    });
    expect(lines.find((line) => line.path === "path with spaces.txt")).toEqual({
      indexStatus: "?",
      workTreeStatus: "?",
      path: "path with spaces.txt",
    });
  });

  it("decodes octal-quoted non-ASCII porcelain paths from git status", () => {
    const lines = parseStatusPorcelain([' M "nested/caf\\303\\251.txt"'].join("\n"));

    expect(lines.find((line) => line.path === "nested/café.txt")).toEqual({
      indexStatus: " ",
      workTreeStatus: "M",
      path: "nested/café.txt",
    });
  });

  it("normalizes Windows backslashes in porcelain paths", () => {
    const lines = parseStatusPorcelain(
      [
        " M src\\components\\App.svelte",
        "?? nested\\folder\\new.txt",
        'R  old\\name.txt -> new\\name.txt',
        '?? "nested\\folder\\spaces file.txt"',
      ].join("\n"),
    );

    expect(lines.find((line) => line.path === "src/components/App.svelte")).toEqual({
      indexStatus: " ",
      workTreeStatus: "M",
      path: "src/components/App.svelte",
    });
    expect(lines.find((line) => line.path === "nested/folder/new.txt")).toEqual({
      indexStatus: "?",
      workTreeStatus: "?",
      path: "nested/folder/new.txt",
    });
    expect(lines.find((line) => line.path === "new/name.txt")).toEqual({
      indexStatus: "R",
      workTreeStatus: " ",
      path: "new/name.txt",
    });
    expect(lines.find((line) => line.path === "nested/folder/spaces file.txt")).toEqual({
      indexStatus: "?",
      workTreeStatus: "?",
      path: "nested/folder/spaces file.txt",
    });
  });
});

describe("parseStatusPorcelainV2Z", () => {
  it("parses v2 fixture rows equivalent to the v1 porcelain fixture", () => {
    const v1Lines = parseStatusPorcelain(readFixture("git-status-porcelain.txt"));
    const v2Lines = parseStatusPorcelainV2Z(readFixture("git-status-porcelain-v2-z.txt"));

    const sortByPath = (left: { path: string }, right: { path: string }) =>
      left.path.localeCompare(right.path, undefined, { sensitivity: "base" });

    expect(v2Lines.toSorted(sortByPath)).toEqual(v1Lines.toSorted(sortByPath));
  });

  it("parses rename records using the destination path", () => {
    const stdout =
      "2 R. N... 100644 100644 100644 abc abc R100 new-name.txt\x00old-name.txt\x00";
    expect(parseStatusPorcelainV2Z(stdout)).toEqual([
      { indexStatus: "R", workTreeStatus: " ", path: "new-name.txt" },
    ]);
  });

  it("parses unmerged conflict records", () => {
    const stdout =
      "u UU N... 100644 100644 100644 100644 abc def ghi conflict.txt\x00";
    expect(parseStatusPorcelainV2Z(stdout)).toEqual([
      { indexStatus: "U", workTreeStatus: "U", path: "conflict.txt" },
    ]);
  });

  it("decodes octal-quoted non-ASCII paths", () => {
    const stdout = '1 .M N... 100644 100644 100644 abc abc "nested/caf\\303\\251.txt"\x00';
    expect(parseStatusPorcelainV2Z(stdout)).toEqual([
      { indexStatus: " ", workTreeStatus: "M", path: "nested/café.txt" },
    ]);
  });

  it("normalizes Windows backslashes in v2 paths", () => {
    const stdout =
      "1 .M N... 100644 100644 100644 abc abc src\\components\\App.svelte\x00" +
      "? nested\\folder\\new.txt\x00" +
      "2 R. N... 100644 100644 100644 abc abc R100 new\\name.txt\x00old\\name.txt\x00";
    const lines = parseStatusPorcelainV2Z(stdout);

    expect(lines.find((line) => line.path === "src/components/App.svelte")).toEqual({
      indexStatus: " ",
      workTreeStatus: "M",
      path: "src/components/App.svelte",
    });
    expect(lines.find((line) => line.path === "nested/folder/new.txt")).toEqual({
      indexStatus: "?",
      workTreeStatus: "?",
      path: "nested/folder/new.txt",
    });
    expect(lines.find((line) => line.path === "new/name.txt")).toEqual({
      indexStatus: "R",
      workTreeStatus: " ",
      path: "new/name.txt",
    });
  });
});

describeIfGitInstalled("parseStatusPorcelainV2Z integration", () => {
  it("parses real git status --porcelain=v2 -z output from a temp repository", () => {
    withTempGitRepo("specops-git-status-v2-", (repo) => {
      repo.writeFile("tracked.txt", "v1");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);

      repo.writeFile("tracked.txt", "v2");
      repo.writeFile("new.txt", "new");
      repo.writeFile("spaces file.txt", "space");

      const stdout = repo.run(["status", "--porcelain=v2", "-z"]) as string;
      const status = splitWorkingTreeStatus(parseStatusPorcelainV2Z(stdout));

      expect(status.unstaged.map((entry) => entry.path).sort()).toEqual([
        "new.txt",
        "spaces file.txt",
        "tracked.txt",
      ]);
      expect(status.staged).toEqual([]);
    });
  });
});

describe("splitWorkingTreeStatus", () => {
  it("splits staged vs unstaged and includes untracked in unstaged", () => {
    const status = splitWorkingTreeStatus(parseStatusPorcelain(readFixture("git-status-porcelain.txt")));

    expect(status.staged.map((entry) => entry.path)).toEqual([
      "added-staged.txt",
      "both-staged-unstaged.txt",
      "deleted-staged.txt",
      "new-name.txt",
      "staged-only.txt",
    ]);
    expect(status.unstaged.map((entry) => entry.path)).toEqual([
      "both-staged-unstaged.txt",
      "deleted-unstaged.txt",
      "path with spaces.txt",
      "README.md",
      "untracked.txt",
    ]);
    expect(status.unstaged.find((entry) => entry.path === "untracked.txt")?.statusCode).toBe("??");
  });
});

describeIfGitInstalled("parseStatusPorcelain integration", () => {
  it("parses real git status output from a temp repository", () => {
    withTempGitRepo("specops-git-status-", (repo) => {
      repo.writeFile("tracked.txt", "v1");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);

      repo.writeFile("tracked.txt", "v2");
      repo.writeFile("new.txt", "new");
      repo.writeFile("spaces file.txt", "space");

      const stdout = repo.run(["status", "--porcelain"]) as string;
      const status = splitWorkingTreeStatus(parseStatusPorcelain(stdout));

      expect(status.unstaged.map((entry) => entry.path).sort()).toEqual([
        "new.txt",
        "spaces file.txt",
        "tracked.txt",
      ]);
      expect(status.staged).toEqual([]);
    });
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
