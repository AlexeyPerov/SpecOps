import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  checkGitAvailable,
  GIT_LOG_FORMAT,
  GIT_SHOW_FORMAT,
  queryAheadBehind,
  queryBranches,
  queryCommitDetail,
  queryCommits,
  queryCurrentBranch,
  queryTags,
  resolveRepoRoot,
  runGit,
} from "./gitService";
import { DEFAULT_COMMIT_LOG_LIMIT } from "./types";
import type { GitAvailableResponse, RunGitResponse } from "./types";
import { isGitError } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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
