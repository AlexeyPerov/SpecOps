import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  applyStash,
  buildQueryCommitsArgs,
  checkGitAvailable,
  createBranch,
  createCommit,
  createStash,
  checkoutBranch,
  createTag,
  deleteLocalTag,
  deleteRemoteTag,
  deleteTag,
  fetchRemote,
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  GitCommitFileDiffNotFoundError,
  GitCommitValidationError,
  GitCommandTimedOutError,
  GitDiffTooLargeError,
  GitNoUpstreamError,
  GitRefValidationError,
  GitStashApplyConflictError,
  GitStashNotFoundError,
  GitStashNothingToSaveError,
  GitTagPartialDeleteError,
  COMMIT_FILE_DIFF_MAX_BYTES,
  DIFF_CONTEXT_LINES,
  isWorkingTreeDirty,
  pullRemote,
  pushRemote,
  pushTag,
  REMOTE_GIT_OPERATION_TIMEOUT_MS,
  queryAheadBehind,
  isNoUpstreamAheadBehindError,
  queryBranches,
  queryCommitDetail,
  queryCommitFileDiff,
  queryCommits,
  queryCurrentBranch,
  queryIsBareRepository,
  queryRemotes,
  queryRemoteTags,
  queryStashes,
  queryTags,
  queryWorkingTreeStatus,
  queryWorkingTreeFileDiff,
  resetGitAvailabilityCacheForTests,
  resolveRepoRoot,
  runGit,
  stageAll,
  stagePaths,
  unstagePaths,
} from "./gitService";
import { resetGitCommandQueueForTests } from "./gitCommandQueue";
import { DEFAULT_COMMIT_LOG_LIMIT, DEFAULT_HISTORY_FILTER_MODE } from "./types";
import type { GitAvailableResponse, RunGitResponse } from "./types";
import { isGitError } from "./types";
import { describeIfGitInstalled, createTempGitRepo, withTempGitRepo } from "./test/gitTempRepoHarness";
import { execFileSync } from "node:child_process";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const REMOTE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
};

function expectRemoteGitInvoke(
  repoRoot: string,
  args: string[],
  operation: string,
  extra: Record<string, unknown> = {},
): void {
  expect(invokeMock).toHaveBeenCalledWith("run_git", {
    repoRoot,
    args,
    askpassEnabled: true,
    askpassOperation: operation,
    env: REMOTE_GIT_ENV,
    timeoutMs: REMOTE_GIT_OPERATION_TIMEOUT_MS,
    ...extra,
  });
}

describe("runGit", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetGitCommandQueueForTests();
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
    resetGitAvailabilityCacheForTests();
    resetGitCommandQueueForTests();
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

  it("reuses cached availability within the TTL", async () => {
    const response: GitAvailableResponse = {
      available: true,
      version: "git version 2.43.0",
      error: null,
    };
    invokeMock.mockResolvedValue(response);

    await checkGitAvailable();
    await checkGitAvailable();

    expect(invokeMock).toHaveBeenCalledTimes(1);
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

  it("returns null when upstream revision is unknown", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: ambiguous argument '@{u}': unknown revision or path not in the working tree.\n",
      durationMs: 2,
    });

    const result = await queryAheadBehind("/tmp/repo");

    expect(result).toBeNull();
  });

  it("throws GitCommandError for lock conflicts", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Unable to create '/tmp/repo/.git/index.lock': File exists.\n",
      durationMs: 2,
    });

    await expect(queryAheadBehind("/tmp/repo")).rejects.toMatchObject({
      kind: "command",
      exitCode: 128,
    });
  });

  it("returns null for unparseable stdout on success", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "unexpected output",
      stderr: "",
      durationMs: 2,
    });

    const result = await queryAheadBehind("/tmp/repo");

    expect(result).toBeNull();
  });
});

describe("isNoUpstreamAheadBehindError", () => {
  it("matches no upstream and unknown revision stderr", () => {
    expect(
      isNoUpstreamAheadBehindError({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: no upstream configured for branch 'main'\n",
        durationMs: 1,
      }),
    ).toBe(true);
    expect(
      isNoUpstreamAheadBehindError({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: unknown revision or path not in the working tree.\n",
        durationMs: 1,
      }),
    ).toBe(true);
  });

  it("does not match lock conflicts", () => {
    expect(
      isNoUpstreamAheadBehindError({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Unable to create '/tmp/repo/.git/index.lock': File exists.\n",
        durationMs: 1,
      }),
    ).toBe(false);
  });
});

describe("buildQueryCommitsArgs", () => {
  it("defaults to current-branch scope with default limit", () => {
    expect(buildQueryCommitsArgs()).toEqual([
      "log",
      "--no-show-signature",
      "--decorate=full",
      `--format=${GIT_LOG_FORMAT}`,
      `-${DEFAULT_COMMIT_LOG_LIMIT}`,
    ]);
  });

  it("adds --branches for all-branches mode", () => {
    expect(buildQueryCommitsArgs({ filterMode: "all-branches", limit: 100 })).toEqual([
      "log",
      "--no-show-signature",
      "--decorate=full",
      `--format=${GIT_LOG_FORMAT}`,
      "--branches",
      "-100",
    ]);
  });

  it("adds --branches and --remotes for all-branches-and-remotes mode", () => {
    expect(
      buildQueryCommitsArgs({ filterMode: "all-branches-and-remotes", limit: 50 }),
    ).toEqual([
      "log",
      "--no-show-signature",
      "--decorate=full",
      `--format=${GIT_LOG_FORMAT}`,
      "--branches",
      "--remotes",
      "-50",
    ]);
  });

  it("omits scope flags for explicit current-branch mode", () => {
    expect(buildQueryCommitsArgs({ filterMode: "current-branch" })).toEqual([
      "log",
      "--no-show-signature",
      "--decorate=full",
      `--format=${GIT_LOG_FORMAT}`,
      `-${DEFAULT_COMMIT_LOG_LIMIT}`,
    ]);
  });

  it("uses DEFAULT_HISTORY_FILTER_MODE when filterMode is omitted", () => {
    expect(DEFAULT_HISTORY_FILTER_MODE).toBe("current-branch");
    const args = buildQueryCommitsArgs({ limit: 10 });
    expect(args).not.toContain("--branches");
    expect(args).not.toContain("--remotes");
    expect(args).not.toContain("--all");
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
      args: buildQueryCommitsArgs({ limit: 25 }),
    });
  });

  it("passes all-branches scope flags to git log", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await queryCommits("/tmp/repo", { filterMode: "all-branches" });

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: buildQueryCommitsArgs({ filterMode: "all-branches" }),
    });
  });

  it("passes all-branches-and-remotes scope flags to git log", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await queryCommits("/tmp/repo", { filterMode: "all-branches-and-remotes", limit: 200 });

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: buildQueryCommitsArgs({ filterMode: "all-branches-and-remotes", limit: 200 }),
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

  it("throws GitDiffTooLargeError when stdout exceeds the size guard", async () => {
    const oversizedStdout = "x".repeat(COMMIT_FILE_DIFF_MAX_BYTES + 1);
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: oversizedStdout,
      stderr: "",
      durationMs: 2,
    });

    await expect(
      queryCommitFileDiff("/tmp/repo", "sha", "large.txt", "parent"),
    ).rejects.toSatisfy((error) => {
      return (
        error instanceof GitDiffTooLargeError &&
        error.path === "large.txt" &&
        error.byteLength === COMMIT_FILE_DIFF_MAX_BYTES + 1 &&
        error.maxBytes === COMMIT_FILE_DIFF_MAX_BYTES
      );
    });
  });

  it("parses binary diff output without throwing", async () => {
    const binaryPatch =
      "diff --git a/image.png b/image.png\nnew file mode 100644\nBinary files /dev/null and b/image.png differ\n";
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: binaryPatch,
      stderr: "",
      durationMs: 2,
    });

    const result = await queryCommitFileDiff("/tmp/repo", "sha", "image.png", "parent");

    expect(result.path).toBe("image.png");
    expect(result.isBinary).toBe(true);
    expect(result.hunks).toEqual([]);
  });
});

describe("queryWorkingTreeFileDiff", () => {
  const samplePatch =
    "diff --git a/file.txt b/file.txt\nindex abc..def 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1,2 @@\n line\n+added\n";

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git diff --cached for staged source", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: samplePatch,
      stderr: "",
      durationMs: 2,
    });

    const result = await queryWorkingTreeFileDiff("/tmp/repo", "file.txt", "staged");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "diff",
        "--no-color",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "--cached",
        "--",
        "file.txt",
      ],
    });
    expect(result.path).toBe("file.txt");
    expect(result.addedLines).toBe(1);
  });

  it("runs git diff HEAD for unstaged tracked files", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: samplePatch,
      stderr: "",
      durationMs: 2,
    });

    await queryWorkingTreeFileDiff("/tmp/repo", "file.txt", "unstaged");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "diff",
        "--no-color",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "HEAD",
        "--",
        "file.txt",
      ],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to git diff --no-index when HEAD diff is empty", async () => {
    const untrackedPatch =
      "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n";
    invokeMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: untrackedPatch,
        stderr: "",
        durationMs: 2,
      });

    const result = await queryWorkingTreeFileDiff("/tmp/repo", "new.txt", "unstaged");

    expect(invokeMock).toHaveBeenNthCalledWith(2, "run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "diff",
        "--no-index",
        "--no-color",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "--",
        "/dev/null",
        "new.txt",
      ],
    });
    expect(result.path).toBe("new.txt");
    expect(result.addedLines).toBe(1);
  });

  it("passes paths with spaces as a single argv entry", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: samplePatch.replace(/file\.txt/g, "spaces file.txt"),
      stderr: "",
      durationMs: 2,
    });

    await queryWorkingTreeFileDiff("/tmp/repo", "spaces file.txt", "staged");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "diff",
        "--no-color",
        "--patch",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "--cached",
        "--",
        "spaces file.txt",
      ],
    });
  });

  it("throws GitDiffTooLargeError when stdout exceeds the size guard", async () => {
    const oversizedStdout = "x".repeat(COMMIT_FILE_DIFF_MAX_BYTES + 1);
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: oversizedStdout,
      stderr: "",
      durationMs: 2,
    });

    await expect(
      queryWorkingTreeFileDiff("/tmp/repo", "large.txt", "staged"),
    ).rejects.toBeInstanceOf(GitDiffTooLargeError);
  });

  it("throws GitCommitFileDiffNotFoundError when no patch is produced", async () => {
    invokeMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      });

    await expect(
      queryWorkingTreeFileDiff("/tmp/repo", "missing.txt", "unstaged"),
    ).rejects.toBeInstanceOf(GitCommitFileDiffNotFoundError);
  });
});

describeIfGitInstalled("queryWorkingTreeFileDiff integration", () => {
  function runRealGit(cwd: string, args: string[]): RunGitResponse {
    try {
      const stdout = execFileSync("git", args, { cwd, encoding: "utf8" });
      return { exitCode: 0, stdout, stderr: "", durationMs: 0 };
    } catch (error) {
      const execError = error as { status?: number; stdout?: string; stderr?: string };
      return {
        exitCode: execError.status ?? 1,
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? "",
        durationMs: 0,
      };
    }
  }

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (_command, request) =>
      runRealGit(
        (request as { repoRoot: string; args: string[] }).repoRoot,
        (request as { repoRoot: string; args: string[] }).args,
      ),
    );
  });

  it("returns different staged vs unstaged diffs after partial staging", async () => {
    const repo = createTempGitRepo("specops-git-wt-diff-");
    try {
      repo.writeFile("tracked.txt", "line1\n");
      repo.run(["add", "tracked.txt"]);
      repo.run(["commit", "-m", "init"]);

      repo.writeFile("tracked.txt", "line1\nline2 staged\n");
      repo.run(["add", "tracked.txt"]);
      repo.writeFile("tracked.txt", "line1\nline2 staged\nline3 unstaged\n");

      const stagedDiff = await queryWorkingTreeFileDiff(repo.dir, "tracked.txt", "staged");
      const unstagedDiff = await queryWorkingTreeFileDiff(repo.dir, "tracked.txt", "unstaged");

      expect(stagedDiff.addedLines).toBe(1);
      expect(unstagedDiff.addedLines).toBe(2);
      expect(stagedDiff.hunks).not.toEqual(unstagedDiff.hunks);
    } finally {
      repo.cleanup();
    }
  });

  it("diffs untracked files via --no-index fallback", async () => {
    const repo = createTempGitRepo("specops-git-wt-untracked-");
    try {
      repo.writeFile("README.md", "base\n");
      repo.run(["add", "README.md"]);
      repo.run(["commit", "-m", "init"]);
      repo.writeFile("brand new.txt", "fresh\n");

      const diff = await queryWorkingTreeFileDiff(repo.dir, "brand new.txt", "unstaged");

      expect(diff.path).toBe("brand new.txt");
      expect(diff.addedLines).toBe(1);
    } finally {
      repo.cleanup();
    }
  });

  it("handles paths with spaces on real git", async () => {
    const repo = createTempGitRepo("specops-git-wt-spaces-");
    try {
      repo.writeFile("README.md", "base\n");
      repo.run(["add", "README.md"]);
      repo.run(["commit", "-m", "init"]);
      repo.writeFile("spaces file.txt", "changed\n");
      repo.run(["add", "spaces file.txt"]);

      const diff = await queryWorkingTreeFileDiff(repo.dir, "spaces file.txt", "staged");

      expect(diff.path).toBe("spaces file.txt");
      expect(diff.addedLines).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
    }
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

  it("runs git status --porcelain=v2 -z and splits staged vs unstaged", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout:
        "1 .M N... 100644 100644 100644 abc abc README.md\x00" +
        "1 M. N... 100644 100644 100644 abc abc staged.txt\x00" +
        "? untracked.txt\x00",
      stderr: "",
      durationMs: 2,
    });

    const result = await queryWorkingTreeStatus("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["status", "--porcelain=v2", "-z"],
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
      stdout: "? file.txt\x00",
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

  it("passes commandId through git_commit_with_message", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "[main abc1234] Subject\n",
      stderr: "",
      durationMs: 3,
    });

    await createCommit("/tmp/repo", "Subject", { commandId: "commit-1" });

    expect(invokeMock).toHaveBeenCalledWith("git_commit_with_message", {
      repoRoot: "/tmp/repo",
      message: "Subject",
      commandId: "commit-1",
    });
  });

  it("throws GitCommandTimedOutError when commit response is timed out", async () => {
    invokeMock.mockResolvedValue({
      exitCode: -1,
      stdout: "",
      stderr: "Git command timed out.",
      durationMs: 600_000,
      timedOut: true,
    });

    await expect(createCommit("/tmp/repo", "Subject", { commandId: "commit-2" })).rejects.toBeInstanceOf(
      GitCommandTimedOutError,
    );
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

    expectRemoteGitInvoke("/tmp/repo", ["fetch"], "fetch");
  });

  it("runs git fetch for an explicit remote", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 120,
    });

    await fetchRemote("/tmp/repo", { remoteName: "upstream" });

    expectRemoteGitInvoke("/tmp/repo", ["fetch", "upstream"], "fetch");
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

    expectRemoteGitInvoke("/tmp/repo", ["pull"], "pull");
  });

  it("runs git pull for an explicit remote and branch", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "Already up to date.\n",
      stderr: "",
      durationMs: 80,
    });

    await pullRemote("/tmp/repo", { remoteName: "origin", branchName: "main" });

    expectRemoteGitInvoke("/tmp/repo", ["pull", "origin", "main"], "pull");
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

    expectRemoteGitInvoke("/tmp/repo", ["push"], "push");
  });

  it("runs git push for an explicit remote", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 120,
    });

    await pushRemote("/tmp/repo", { remoteName: "upstream" });

    expectRemoteGitInvoke("/tmp/repo", ["push", "upstream", "HEAD"], "push");
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

describe("queryRemotes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git remote -v and parses remotes", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "origin\thttps://example.com/repo.git (fetch)\norigin\thttps://example.com/repo.git (push)\n",
      stderr: "",
      durationMs: 2,
    });

    await expect(queryRemotes("/tmp/repo")).resolves.toEqual([
      {
        name: "origin",
        fetchUrl: "https://example.com/repo.git",
        pushUrl: "https://example.com/repo.git",
      },
    ]);
  });

  it("returns an empty array when no remotes are configured", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await expect(queryRemotes("/tmp/repo")).resolves.toEqual([]);
  });
});

describe("queryRemoteTags", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git ls-remote --tags and parses tag names", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "abc123\trefs/tags/v1.0.0\n",
      stderr: "",
      durationMs: 3,
    });

    await expect(queryRemoteTags("/tmp/repo", "origin")).resolves.toEqual(["v1.0.0"]);
    expectRemoteGitInvoke("/tmp/repo", ["ls-remote", "--tags", "origin"], "lsRemote");
  });

  it("rejects empty remote names before invoking git", async () => {
    await expect(queryRemoteTags("/tmp/repo", "  ")).rejects.toBeInstanceOf(
      GitRefValidationError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("pushTag", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git push with refs/tags ref", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 4,
    });

    await pushTag("/tmp/repo", "origin", "v1.0.0");

    expectRemoteGitInvoke("/tmp/repo", ["push", "origin", "refs/tags/v1.0.0"], "tagPush");
  });

  it("rejects invalid tag names before invoking git", async () => {
    await expect(pushTag("/tmp/repo", "origin", "bad tag")).rejects.toBeInstanceOf(
      GitRefValidationError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects empty remote names before invoking git", async () => {
    await expect(pushTag("/tmp/repo", " ", "v1.0.0")).rejects.toBeInstanceOf(
      GitRefValidationError,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("deleteRemoteTag", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("runs git push --delete with refs/tags ref", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 4,
    });

    await deleteRemoteTag("/tmp/repo", "origin", "v1.0.0");

    expectRemoteGitInvoke(
      "/tmp/repo",
      ["push", "--delete", "origin", "refs/tags/v1.0.0"],
      "tagDelete",
    );
  });
});

describe("deleteTag", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("deletes locally only when no remotes are provided", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await deleteTag("/tmp/repo", "v1.0.0");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["tag", "-d", "v1.0.0"],
    });
  });

  it("deletes on each remote when remoteNames are provided", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await deleteTag("/tmp/repo", "v1.0.0", { remoteNames: ["origin", "upstream"] });

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "run_git", {
      repoRoot: "/tmp/repo",
      args: ["tag", "-d", "v1.0.0"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "run_git", {
      repoRoot: "/tmp/repo",
      args: ["push", "--delete", "origin", "refs/tags/v1.0.0"],
      askpassEnabled: true,
      askpassOperation: "tagDelete",
      env: REMOTE_GIT_ENV,
      timeoutMs: REMOTE_GIT_OPERATION_TIMEOUT_MS,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "run_git", {
      repoRoot: "/tmp/repo",
      args: ["push", "--delete", "upstream", "refs/tags/v1.0.0"],
      askpassEnabled: true,
      askpassOperation: "tagDelete",
      env: REMOTE_GIT_ENV,
      timeoutMs: REMOTE_GIT_OPERATION_TIMEOUT_MS,
    });
  });

  it("throws partial delete error when remote delete fails after local success", async () => {
    invokeMock
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: remote error\n",
        durationMs: 2,
      });

    await expect(deleteTag("/tmp/repo", "v1.0.0", { remoteNames: ["origin"] })).rejects.toBeInstanceOf(
      GitTagPartialDeleteError,
    );
  });
});

describeIfGitInstalled("pushTag integration", () => {
  it("pushes a tag to a local bare remote", () => {
    withTempGitRepo("specops-git-push-tag-src-", (repo) => {
      const bare = createTempGitRepo("specops-git-push-tag-bare-");
      try {
        execFileSync("git", ["remote", "add", "origin", bare.dir], { cwd: repo.dir });
        repo.writeFile("file.txt", "content");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "init"]);
        repo.run(["tag", "v1.0.0"]);
        repo.run(["push", "origin", "refs/tags/v1.0.0"]);

        const remoteTags = bare.run(["tag", "-l"]) as string;
        expect(remoteTags.trim()).toBe("v1.0.0");
      } finally {
        bare.cleanup();
      }
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

describe("createStash", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes git stash push with include-untracked and message", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 3,
    });

    await createStash("/tmp/repo", "WIP before checkout", true);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["stash", "push", "--include-untracked", "-m", "WIP before checkout"],
    });
  });

  it("omits include-untracked when disabled", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await createStash("/tmp/repo", undefined, false);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["stash", "push"],
    });
  });

  it("throws GitStashNothingToSaveError when git reports no changes", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "No local changes to save\n",
      durationMs: 1,
    });

    await expect(createStash("/tmp/repo")).rejects.toBeInstanceOf(GitStashNothingToSaveError);
  });
});

describe("queryStashes", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes structured stash list and parses rows", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout:
        "abc1111111111111111111111111111111111111111\ndef2222222222222222222222222222222222222222\n1700000000\nstash@{0}\nWIP on main\0",
      stderr: "",
      durationMs: 2,
    });

    const rows = await queryStashes("/tmp/repo");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: [
        "stash",
        "list",
        "-z",
        "--no-show-signature",
        "--format=%H%n%P%n%ct%n%gd%n%B",
      ],
    });
    expect(rows).toEqual([
      {
        sha: "abc1111111111111111111111111111111111111111",
        parents: ["def2222222222222222222222222222222222222222"],
        ref: "stash@{0}",
        createdAt: 1_700_000_000,
        message: "WIP on main",
      },
    ]);
  });

  it("returns an empty list for blank stdout", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    });

    await expect(queryStashes("/tmp/repo")).resolves.toEqual([]);
  });
});

describe("applyStash", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes git stash apply by default", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await applyStash("/tmp/repo", "stash@{0}");

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["stash", "apply", "-q", "stash@{0}"],
    });
  });

  it("invokes git stash pop --index when pop is true", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 2,
    });

    await applyStash("/tmp/repo", "stash@{1}", true);

    expect(invokeMock).toHaveBeenCalledWith("run_git", {
      repoRoot: "/tmp/repo",
      args: ["stash", "pop", "-q", "--index", "stash@{1}"],
    });
  });

  it("throws GitStashNotFoundError for missing stash refs", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "fatal: log for 'stash' only has 1 entries\n",
      durationMs: 1,
    });

    await expect(applyStash("/tmp/repo", "stash@{9}")).rejects.toBeInstanceOf(
      GitStashNotFoundError,
    );
  });

  it("throws GitStashApplyConflictError when apply conflicts", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "error: could not apply stash@{0}\nCONFLICT (content): Merge conflict in file.txt\n",
      durationMs: 2,
    });

    await expect(applyStash("/tmp/repo", "stash@{0}")).rejects.toBeInstanceOf(
      GitStashApplyConflictError,
    );
  });
});
