import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  checkGitAvailable,
  createBranch,
  createCommit,
  checkoutBranch,
  createTag,
  deleteLocalTag,
  fetchRemote,
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  GitCommitFileDiffNotFoundError,
  GitCommitValidationError,
  GitNoUpstreamError,
  GitRefValidationError,
  DIFF_CONTEXT_LINES,
  isWorkingTreeDirty,
  pullRemote,
  pushRemote,
  queryAheadBehind,
  queryBranches,
  queryCommitDetail,
  queryCommitFileDiff,
  queryCommits,
  queryCurrentBranch,
  queryIsBareRepository,
  queryTags,
  queryWorkingTreeStatus,
  resolveRepoRoot,
  runGit,
  stageAll,
  stagePaths,
  unstagePaths,
} from "./gitService";
import { DEFAULT_COMMIT_LOG_LIMIT } from "./types";
import type { GitAvailableResponse, RunGitResponse } from "./types";
import { isGitError } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("runGit", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes run_git with repoRoot and args", async () => {
    const response: RunGitResponse = {
      exitCode: 0,
      stdout: "On branch main\n",
      stderr: "",
      durationMs: 4,
    };
    invokeMock.mockResolvedValue(response);

    const result = await runGit("/tmp/repo", ["status"]);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["status"],
    });
    expect(result).toEqual(response);
  });

  it("passes optional env map to run_git", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await runGit("/tmp/repo", ["status"], { GIT_TERMINAL_PROMPT: "0" });

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["status"],
      env: { GIT_TERMINAL_PROMPT: "0" },
    });
  });

  it("maps Tauri validation errors to typed GitInvalidPathError", async () => {
    invokeMock.mockRejectedValue("repo_root must be an absolute path");

    await expect(runGit("relative/path", ["status"])).rejects.toSatisfy((error) => {
      return (
        isGitError(error) &&
        error.kind === "invalidPath" &&
        error.workspaceRootPath === "relative/path"
      );
    });
  });
});

describe("checkGitAvailable", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes git_available and returns the response", async () => {
    const response: GitAvailableResponse = {
      available: true,
      version: "git version 2.43.0",
      error: null,
    };
    invokeMock.mockResolvedValue(response);

    const result = await checkGitAvailable();

    expect(invokeMock).toHaveBeenCalledWith("git_available");
    expect(result).toEqual(response);
  });
});

describe("resolveRepoRoot", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("resolves repo root when workspace is a nested subdirectory", async () => {
    const repoRoot = "/tmp/example-repo";
    const nestedWorkspace = "/tmp/example-repo/packages/nested";
    const response: RunGitResponse = {
      exitCode: 0,
      stdout: `${repoRoot}\n`,
      stderr: "",
      durationMs: 12,
    };
    invokeMock.mockResolvedValue(response);

    const result = await resolveRepoRoot(nestedWorkspace);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: nestedWorkspace,
      args: ["rev-parse", "--show-toplevel"],
    });
    expect(result).toEqual({ ok: true, repoRoot });
  });

  it("returns typed not-a-repository error when path is outside a repo", async () => {
    const workspaceRootPath = "/tmp/not-a-repo";
    const response: RunGitResponse = {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      durationMs: 8,
    };
    invokeMock.mockResolvedValue(response);

    const result = await resolveRepoRoot(workspaceRootPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "notARepository",
        message:
          "fatal: not a git repository (or any of the parent directories): .git",
        workspaceRootPath,
      });
    }
  });

  it("maps stderr-only not-a-repo messages to typed error", async () => {
    const workspaceRootPath = "/tmp/also-not-a-repo";
    const response: RunGitResponse = {
      exitCode: 1,
      stdout: "",
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      durationMs: 5,
    };
    invokeMock.mockResolvedValue(response);

    const result = await resolveRepoRoot(workspaceRootPath);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("notARepository");
      expect(result.error.workspaceRootPath).toBe(workspaceRootPath);
    }
  });
});

describe("queryCurrentBranch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns attached branch name and upstream when configured", async () => {
    invokeMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "main\n",
        stderr: "",
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "origin/main\n",
        stderr: "",
        durationMs: 1,
      });

    const result = await queryCurrentBranch("/tmp/repo");

    expect(result).toEqual({
      name: "main",
      isDetached: false,
      upstream: "origin/main",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "run_git", {
      repoRoot: "/tmp/repo",
      args: ["branch", "--show-current"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "run_git", {
      repoRoot: "/tmp/repo",
      args: ["rev-parse", "--abbrev-ref", "@{upstream}"],
    });
  });

  it("returns detached HEAD short SHA with no upstream", async () => {
    invokeMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "\n",
        stderr: "",
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "a607443\n",
        stderr: "",
        durationMs: 1,
      });

    const result = await queryCurrentBranch("/tmp/repo");

    expect(result).toEqual({
      name: "a607443",
      isDetached: true,
      upstream: null,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "run_git", {
      repoRoot: "/tmp/repo",
      args: ["rev-parse", "--short", "HEAD"],
    });
  });

  it("returns null upstream when rev-parse upstream fails", async () => {
    invokeMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "main\n",
        stderr: "",
        durationMs: 2,
      })
      .mockResolvedValueOnce({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: no upstream configured for branch 'main'\n",
        durationMs: 1,
      });

    const result = await queryCurrentBranch("/tmp/repo");

    expect(result).toEqual({
      name: "main",
      isDetached: false,
      upstream: null,
    });
  });
});

describe("queryAheadBehind", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns ahead/behind counts when upstream exists", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "2\t3\n",
      stderr: "",
      durationMs: 3,
    });

    const result = await queryAheadBehind("/tmp/repo");

    expect(result).toEqual({ behind: 2, ahead: 3 });
    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    });
  });

  it("returns null when upstream is not configured", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: no upstream configured for branch 'main'\n",
      durationMs: 2,
    });

    const result = await queryAheadBehind("/tmp/repo");

    expect(result).toBeNull();
  });
});

describe("queryCommits", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs structured git log with default limit and parses commits", async () => {
    const stdout =
      "abc123\x00def456\x00HEAD -> refs/heads/main\x00Dev±dev@example.com\x001700000000\x00Dev±dev@example.com\x001700000000\x00Latest\n";
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout,
      stderr: "",
      durationMs: 5,
    });

    const result = await queryCommits("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "log",
        "--no-show-signature",
        "--decorate=full",
        `--format=${GIT_LOG_FORMAT}`,
        `-${DEFAULT_COMMIT_LOG_LIMIT}`,
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.sha).toBe("abc123");
    expect(result[0]?.refs).toEqual([{ type: "currentBranchHead", name: "main" }]);
    expect(result[0]?.subject).toBe("Latest");
  });

  it("honors a custom limit option", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await queryCommits("/tmp/repo", { limit: 25 });

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "log",
        "--no-show-signature",
        "--decorate=full",
        `--format=${GIT_LOG_FORMAT}`,
        "-25",
      ],
    });
  });

  it("throws GitCommandError when git log fails", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: bad default revision 'HEAD'\n",
      durationMs: 2,
    });

    await expect(queryCommits("/tmp/repo")).rejects.toSatisfy((error) => {
      return isGitError(error) && error.kind === "command" && error.exitCode === 128;
    });
  });
});

describe("queryCommitDetail", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git show --name-status with structured format and parses detail", async () => {
    const stdout =
      "abc123\x00def456\x00Dev\x00dev@example.com\x001700000000\x00Dev\x00dev@example.com\x001700000000\x00Subject line\n\nA\tnew.txt\nM\texisting.ts\n";
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout,
      stderr: "",
      durationMs: 4,
    });

    const result = await queryCommitDetail("/tmp/repo", "abc123");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["show", "--name-status", `--format=${GIT_SHOW_FORMAT}`, "abc123"],
    });
    expect(result.sha).toBe("abc123");
    expect(result.message).toBe("Subject line");
    expect(result.files).toEqual([
      { status: "A", path: "new.txt" },
      { status: "M", path: "existing.ts" },
    ]);
  });

  it("throws GitCommandError when git show fails", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: bad object abc123\n",
      durationMs: 2,
    });

    await expect(queryCommitDetail("/tmp/repo", "abc123")).rejects.toSatisfy((error) => {
      return isGitError(error) && error.kind === "command" && error.exitCode === 128;
    });
  });
});

describe("queryCommitFileDiff", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  const samplePatch =
    "diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1,2 @@\n-old\n+new\n+added\n";

  it("runs git diff parent..sha for commits with a parent", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: samplePatch,
      stderr: "",
      durationMs: 3,
    });

    const result = await queryCommitFileDiff("/tmp/repo", "child", "file.txt", "parent");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "parent..child",
        "--",
        "file.txt",
      ],
    });
    expect(result.path).toBe("file.txt");
    expect(result.addedLines).toBe(2);
    expect(result.deletedLines).toBe(1);
  });

  it("runs git show for root commits without parentSha", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: samplePatch,
      stderr: "",
      durationMs: 3,
    });

    await queryCommitFileDiff("/tmp/repo", "root", "file.txt");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "show",
        "--no-color",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "root",
        "--",
        "file.txt",
      ],
    });
  });

  it("matches renamed files by previous path", async () => {
    const renamePatch =
      "diff --git a/old.txt b/new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-old\n+new\n";
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: renamePatch,
      stderr: "",
      durationMs: 3,
    });

    const result = await queryCommitFileDiff("/tmp/repo", "sha", "old.txt", "parent");

    expect(result.path).toBe("new.txt");
    expect(result.oldPath).toBe("old.txt");
  });

  it("throws GitCommandError when git diff fails", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: bad revision\n",
      durationMs: 2,
    });

    await expect(queryCommitFileDiff("/tmp/repo", "bad", "file.txt", "parent")).rejects.toSatisfy(
      (error) => isGitError(error) && error.kind === "command" && error.exitCode === 128,
    );
  });

  it("throws GitCommitFileDiffNotFoundError when path is missing from patch", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: samplePatch,
      stderr: "",
      durationMs: 2,
    });

    await expect(
      queryCommitFileDiff("/tmp/repo", "sha", "missing.txt", "parent"),
    ).rejects.toBeInstanceOf(GitCommitFileDiffNotFoundError);
  });
});

describe("queryTags", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git tag -l and returns alphabetically sorted tag names", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "v2.0.0\nalpha\nv1.0.0\n",
      stderr: "",
      durationMs: 2,
    });

    const result = await queryTags("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["tag", "-l"],
    });
    expect(result).toEqual(["alpha", "v1.0.0", "v2.0.0"]);
  });

  it("throws GitCommandError when git tag fails", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository\n",
      durationMs: 2,
    });

    await expect(queryTags("/tmp/repo")).rejects.toSatisfy((error) => {
      return isGitError(error) && error.kind === "command" && error.exitCode === 128;
    });
  });
});

describe("queryBranches", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git branch -vv and parses branches with current marker", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "  feature/login fe3fcdb Add login flow\n* master        0154eaa Initial commit\n",
      stderr: "",
      durationMs: 3,
    });

    const result = await queryBranches("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["branch", "-vv"],
    });
    expect(result).toHaveLength(2);
    expect(result.find((branch) => branch.isCurrent)?.name).toBe("master");
  });

  it("throws GitCommandError when git branch fails", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository\n",
      durationMs: 2,
    });

    await expect(queryBranches("/tmp/repo")).rejects.toSatisfy((error) => {
      return isGitError(error) && error.kind === "command" && error.exitCode === 128;
    });
  });
});

describe("queryWorkingTreeStatus", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git status --porcelain and splits staged vs unstaged", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: " M README.md\nM  staged.txt\n?? untracked.txt\n",
      stderr: "",
      durationMs: 2,
    });

    const result = await queryWorkingTreeStatus("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["status", "--porcelain"],
    });
    expect(result.staged.map((entry) => entry.path)).toEqual(["staged.txt"]);
    expect(result.unstaged.map((entry) => entry.path).sort()).toEqual([
      "README.md",
      "untracked.txt",
    ]);
  });
});

describe("isWorkingTreeDirty", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns false for clean porcelain output", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await expect(isWorkingTreeDirty("/tmp/repo")).resolves.toBe(false);
  });

  it("returns true when porcelain has entries", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "?? file.txt\n",
      stderr: "",
      durationMs: 1,
    });

    await expect(isWorkingTreeDirty("/tmp/repo")).resolves.toBe(true);
  });
});

describe("stagePaths and unstagePaths", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git add with path separator for paths containing spaces", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await stagePaths("/tmp/repo", ["path with spaces.txt", "plain.txt"]);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["add", "--", "path with spaces.txt", "plain.txt"],
    });
  });

  it("passes forward-slash paths to git add after Windows-style normalization", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await stagePaths("/tmp/repo", ["nested/folder/file.ts"]);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["add", "--", "nested/folder/file.ts"],
    });
  });

  it("runs git restore --staged for unstage", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await unstagePaths("/tmp/repo", ["staged.txt"]);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["restore", "--staged", "--", "staged.txt"],
    });
  });

  it("runs git add -A for stage all", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await stageAll("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["add", "-A"],
    });
  });
});

describe("createCommit", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes git_commit_with_message with trimmed message", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "[main abc1234] Subject\n",
      stderr: "",
      durationMs: 3,
    });

    await createCommit("/tmp/repo", "  Subject line  ");

    expect(invokeMock).toHaveBeenCalledWith("git_commit_with_message", {
      repoRoot: "/tmp/repo",
      message: "Subject line",
    });
  });

  it("rejects empty message before invoking git", async () => {
    await expect(createCommit("/tmp/repo", "   ")).rejects.toBeInstanceOf(
      GitCommitValidationError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("checkoutBranch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git checkout with branch name", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await checkoutBranch("/tmp/repo", "feature/login");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["checkout", "feature/login"],
    });
  });
});

describe("fetchRemote", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git fetch", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 120,
    });

    await fetchRemote("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["fetch"],
    });
  });

  it("throws GitCommandError when git fetch fails", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: unable to access 'https://example.com/repo.git/': Could not resolve host\n",
      durationMs: 50,
    });

    await expect(fetchRemote("/tmp/repo")).rejects.toSatisfy((error) => {
      return (
        isGitError(error) &&
        error.kind === "command" &&
        error.exitCode === 128 &&
        error.stderr.includes("Could not resolve host")
      );
    });
  });
});

describe("createBranch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git checkout -b for valid branch names", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await createBranch("/tmp/repo", "feature/new");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["checkout", "-b", "feature/new"],
    });
  });

  it("rejects invalid branch names before invoking git", async () => {
    await expect(createBranch("/tmp/repo", "bad name")).rejects.toBeInstanceOf(
      GitRefValidationError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("pullRemote", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git pull", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "Already up to date.\n",
      stderr: "",
      durationMs: 80,
    });

    await pullRemote("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["pull"],
    });
  });

  it("throws GitCommandError on merge conflict", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "error: Your local changes to the following files would be overwritten by merge:\n",
      durationMs: 40,
    });

    await expect(pullRemote("/tmp/repo")).rejects.toSatisfy((error) => {
      return isGitError(error) && error.kind === "command" && error.exitCode === 1;
    });
  });
});

describe("pushRemote", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git push", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 120,
    });

    await pushRemote("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["push"],
    });
  });

  it("throws GitNoUpstreamError when branch has no upstream", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr:
        "fatal: The current branch main has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin main\n",
      durationMs: 5,
    });

    await expect(pushRemote("/tmp/repo")).rejects.toBeInstanceOf(GitNoUpstreamError);
    await expect(pushRemote("/tmp/repo")).rejects.toMatchObject({
      branchName: "main",
      message: expect.stringContaining("no upstream"),
    });
  });

  it("throws GitCommandError for other push failures", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Authentication failed for 'https://example.com/repo.git/'\n",
      durationMs: 50,
    });

    await expect(pushRemote("/tmp/repo")).rejects.toSatisfy((error) => {
      return (
        isGitError(error) &&
        error.kind === "command" &&
        error.stderr.includes("Authentication failed")
      );
    });
  });
});

describe("createTag", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git tag for valid names", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await createTag("/tmp/repo", "v1.0.0");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["tag", "v1.0.0"],
    });
  });

  it("rejects invalid tag names before invoking git", async () => {
    await expect(createTag("/tmp/repo", "bad tag")).rejects.toBeInstanceOf(GitRefValidationError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("surfaces duplicate tag git error", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: tag 'v1.0.0' already exists\n",
      durationMs: 2,
    });

    await expect(createTag("/tmp/repo", "v1.0.0")).rejects.toSatisfy((error) => {
      return isGitError(error) && error.kind === "command" && error.stderr.includes("already exists");
    });
  });
});

describe("deleteLocalTag", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git tag -d", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "Deleted tag 'v1.0.0' (was abc1234)\n",
      stderr: "",
      durationMs: 2,
    });

    await deleteLocalTag("/tmp/repo", "v1.0.0");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["tag", "-d", "v1.0.0"],
    });
  });
});

describe("queryIsBareRepository", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("returns true when git reports bare repository", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "true\n",
      stderr: "",
      durationMs: 1,
    });

    await expect(queryIsBareRepository("/tmp/bare.git")).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/bare.git",
      args: ["rev-parse", "--is-bare-repository"],
    });
  });

  it("returns false for non-bare repositories", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "false\n",
      stderr: "",
      durationMs: 1,
    });

    await expect(queryIsBareRepository("/tmp/repo")).resolves.toBe(false);
  });
});

describe("git command logging", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("logs command summary after runGit", async () => {
    const { logDiagnostic } = await import("../services/logging");
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 3,
    });

    await runGit("/tmp/repo", ["status"]);

    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        message: "git status → exit 0",
        metadata: expect.objectContaining({
          exitCode: 0,
          command: ["status"],
        }),
      }),
    );
  });
});
