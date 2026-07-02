import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkGitAvailable, resolveRepoRoot, runGit } from "./gitService";
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
