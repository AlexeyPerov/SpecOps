import { describe, expect, it } from "vitest";
import {
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  GIT_STASH_LIST_FORMAT,
  parseBranchVvLines,
  parseCommitShow,
  parseLogCommits,
  parseStatusPorcelain,
  parseStatusShortBranchHeader,
  parseStashList,
  parseTagList,
  splitWorkingTreeStatus,
} from "./gitParse";
import {
  createTempGitRepo,
  describeIfGitInstalled,
  withTempGitRepo,
} from "./test/gitTempRepoHarness";

describeIfGitInstalled("git integration (temp repo harness)", () => {
  it("init → commit → log parser round-trip", () => {
    withTempGitRepo("specops-git-integration-log-", (repo) => {
      repo.writeFile("README.md", "hello");
      repo.run(["add", "README.md"]);
      repo.run(["commit", "-m", "Initial commit"]);

      repo.writeFile("README.md", "updated");
      repo.run(["add", "README.md"]);
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
      expect(commits[1]?.subject).toBe("Initial commit");
      expect(commits[0]?.refs.some((ref) => ref.type === "tag" && ref.name === "v1.0")).toBe(
        true,
      );
      expect(commits[0]?.refs.some((ref) => ref.type === "currentBranchHead")).toBe(true);
    });
  });

  it("status -sb parser round-trip for branch and dirty state", () => {
    withTempGitRepo("specops-git-integration-status-sb-", (repo) => {
      repo.writeFile("tracked.txt", "v1");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);
      repo.writeFile("dirty.txt", "change");

      const stdout = repo.run(["status", "-sb"]) as string;
      const headerLine = stdout.split("\n").find((line) => line.startsWith("## "));
      expect(headerLine).toBeDefined();

      const parsed = parseStatusShortBranchHeader(headerLine!);
      expect(parsed?.branchName).toBeTruthy();
      expect(parsed?.isDetached).toBe(false);
      expect(parsed?.upstream).toBeNull();
      expect(parsed?.aheadBehind).toBeNull();
      expect(parseStatusPorcelain(stdout).length).toBeGreaterThan(0);
    });
  });

  it("init → modify files → status parser round-trip", () => {
    withTempGitRepo("specops-git-integration-status-", (repo) => {
      repo.writeFile("tracked.txt", "v1");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);

      repo.writeFile("tracked.txt", "v2");
      repo.writeFile("new.txt", "new");
      repo.writeFile("spaces file.txt", "space");

      const stdout = repo.run(["status", "--porcelain"]) as string;
      const status = splitWorkingTreeStatus(parseStatusPorcelain(stdout));

      expect(status.staged).toEqual([]);
      expect(status.unstaged.map((entry) => entry.path).sort()).toEqual([
        "new.txt",
        "spaces file.txt",
        "tracked.txt",
      ]);
    });
  });

  it("init → commit → show + branch + tag parsers round-trip", () => {
    const repo = createTempGitRepo("specops-git-integration-mixed-");
    try {
      repo.writeFile("added.txt", "content");
      repo.run(["add", "added.txt"]);
      repo.run(["commit", "-m", "Add file"]);
      repo.run(["tag", "release-1"]);

      const showStdout = repo.run([
        "show",
        "--name-status",
        `--format=${GIT_SHOW_FORMAT}`,
        "HEAD",
      ]) as string;
      const detail = parseCommitShow(showStdout);
      expect(detail?.message).toContain("Add file");
      expect(detail?.files).toEqual([{ status: "A", path: "added.txt" }]);

      const branchStdout = repo.run(["branch", "-vv"]) as string;
      const branches = parseBranchVvLines(branchStdout);
      expect(branches.some((branch) => branch.isCurrent)).toBe(true);

      const tagStdout = repo.run(["tag", "-l"]) as string;
      expect(parseTagList(tagStdout)).toEqual(["release-1"]);
    } finally {
      repo.cleanup();
    }
  });

  it("handles paths with spaces and non-ASCII characters on real git", () => {
    withTempGitRepo("specops-git-integration-paths-", (repo) => {
      repo.writeFile("spaces file.txt", "space");
      repo.writeFile("nested/café.txt", "unicode");
      repo.run(["add", "spaces file.txt", "nested/café.txt"]);
      repo.run(["commit", "-m", "paths with spaces and non-ASCII"]);

      repo.writeFile("spaces file.txt", "changed");
      repo.writeFile("nested/café.txt", "changed");

      const stdout = repo.run(["status", "--porcelain"]) as string;
      const status = splitWorkingTreeStatus(parseStatusPorcelain(stdout));

      expect(status.unstaged.map((entry) => entry.path).sort()).toEqual([
        "nested/café.txt",
        "spaces file.txt",
      ]);

      const showStdout = repo.run([
        "show",
        "--name-status",
        `--format=${GIT_SHOW_FORMAT}`,
        "HEAD",
      ]) as string;
      const detail = parseCommitShow(showStdout);
      expect(detail?.files.map((file) => file.path).sort()).toEqual([
        "nested/café.txt",
        "spaces file.txt",
      ]);
    });
  });

  it("stash list format round-trip", () => {
    withTempGitRepo("specops-git-integration-stash-", (repo) => {
      repo.writeFile("tracked.txt", "v1");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);
      repo.writeFile("tracked.txt", "v2");
      repo.run(["stash", "push", "--include-untracked", "-m", "integration stash"]);

      const stdout = repo.run([
        "stash",
        "list",
        "-z",
        "--no-show-signature",
        `--format=${GIT_STASH_LIST_FORMAT}`,
      ]) as string;

      const rows = parseStashList(stdout);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ref).toBe("stash@{0}");
      expect(rows[0]?.message).toContain("integration stash");
      expect(rows[0]?.createdAt).toBeGreaterThan(0);
    });
  });
});
