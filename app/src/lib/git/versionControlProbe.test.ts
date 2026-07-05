import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resetGitAvailabilityCacheForTests, LOCAL_GIT_OPERATION_TIMEOUT_MS } from "./gitService";
import { resetGitCommandQueueForTests } from "./gitCommandQueue";
import {
  initRepositoryAtWorkspaceRoot,
  probeVersionControlContext,
  workspaceUsesParentRepository,
} from "./versionControlProbe";
import type { GitAvailableResponse, RunGitResponse } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("probeVersionControlContext", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetGitAvailabilityCacheForTests();
    resetGitCommandQueueForTests();
  });

  it("returns noWorkspace when workspace root is null", async () => {
    const result = await probeVersionControlContext(null);
    expect(result).toEqual({ kind: "noWorkspace" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns gitUnavailable when git is missing", async () => {
    const gitResponse: GitAvailableResponse = {
      available: false,
      version: null,
      error: "git executable not found",
    };
    invokeMock.mockResolvedValueOnce(gitResponse);

    const result = await probeVersionControlContext("/tmp/workspace");

    expect(result).toEqual({
      kind: "gitUnavailable",
      error: "git executable not found",
    });
  });

  it("returns notARepository when workspace is outside a repo", async () => {
    const gitResponse: GitAvailableResponse = {
      available: true,
      version: "git version 2.43.0",
      error: null,
    };
    const revParseResponse: RunGitResponse = {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      durationMs: 4,
    };
    invokeMock.mockResolvedValueOnce(gitResponse).mockResolvedValueOnce(revParseResponse);

    const result = await probeVersionControlContext("/tmp/empty-workspace");

    expect(result).toEqual({
      kind: "notARepository",
      workspaceRootPath: "/tmp/empty-workspace",
    });
  });

  it("returns ready with repo root when workspace is inside a repo", async () => {
    const gitResponse: GitAvailableResponse = {
      available: true,
      version: "git version 2.43.0",
      error: null,
    };
    const revParseResponse: RunGitResponse = {
      exitCode: 0,
      stdout: "/tmp/example-repo\n",
      stderr: "",
      durationMs: 3,
    };
    const bareResponse: RunGitResponse = {
      exitCode: 0,
      stdout: "false\n",
      stderr: "",
      durationMs: 1,
    };
    invokeMock
      .mockResolvedValueOnce(gitResponse)
      .mockResolvedValueOnce(revParseResponse)
      .mockResolvedValueOnce(bareResponse);

    const result = await probeVersionControlContext("/tmp/example-repo/packages/nested");

    expect(result).toEqual({
      kind: "ready",
      workspaceRootPath: "/tmp/example-repo/packages/nested",
      repoRoot: "/tmp/example-repo",
      isBareRepository: false,
    });
  });

  it("returns ready with isBareRepository when repo is bare", async () => {
    const gitResponse: GitAvailableResponse = {
      available: true,
      version: "git version 2.43.0",
      error: null,
    };
    const revParseResponse: RunGitResponse = {
      exitCode: 0,
      stdout: "/tmp/bare-repo.git\n",
      stderr: "",
      durationMs: 3,
    };
    const bareResponse: RunGitResponse = {
      exitCode: 0,
      stdout: "true\n",
      stderr: "",
      durationMs: 1,
    };
    invokeMock
      .mockResolvedValueOnce(gitResponse)
      .mockResolvedValueOnce(revParseResponse)
      .mockResolvedValueOnce(bareResponse);

    const result = await probeVersionControlContext("/tmp/bare-repo.git");

    expect(result).toEqual({
      kind: "ready",
      workspaceRootPath: "/tmp/bare-repo.git",
      repoRoot: "/tmp/bare-repo.git",
      isBareRepository: true,
    });
  });
});

describe("initRepositoryAtWorkspaceRoot", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetGitAvailabilityCacheForTests();
    resetGitCommandQueueForTests();
  });

  it("runs git init and configures local identity when unset", async () => {
    const initResponse: RunGitResponse = {
      exitCode: 0,
      stdout: "Initialized empty Git repository in /tmp/new-repo/.git/\n",
      stderr: "",
      durationMs: 6,
    };
    invokeMock.mockImplementation(async (_command, request) => {
      const payload = request as { args: string[] };
      const [subcommand, ...rest] = payload.args;
      if (subcommand === "init") {
        return initResponse;
      }
      if (subcommand === "rev-parse" && rest[0] === "--show-toplevel") {
        return {
          exitCode: 0,
          stdout: "/tmp/new-repo\n",
          stderr: "",
          durationMs: 1,
        };
      }
      if (subcommand === "config" && rest[0] === "--get") {
        return { exitCode: 1, stdout: "", stderr: "", durationMs: 1 };
      }
      if (subcommand === "config" && rest[0] === "user.name") {
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      }
      if (subcommand === "config" && rest[0] === "user.email") {
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      }
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    });

    const result = await initRepositoryAtWorkspaceRoot("/tmp/new-repo");

    expect(result).toEqual(initResponse);
    expect(invokeMock).toHaveBeenCalledWith(
      "run_git",
      expect.objectContaining({ args: ["init"], repoRoot: "/tmp/new-repo" }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "run_git",
      expect.objectContaining({ args: ["config", "user.name", "SpecOps User"] }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "run_git",
      expect.objectContaining({ args: ["config", "user.email", "specops@localhost"] }),
    );
  });
});

describe("workspaceUsesParentRepository", () => {
  it("returns true when workspace is nested inside the resolved repo root", () => {
    expect(
      workspaceUsesParentRepository("/tmp/example-repo/packages/nested", "/tmp/example-repo"),
    ).toBe(true);
  });

  it("returns false when workspace root matches the repo root", () => {
    expect(workspaceUsesParentRepository("/tmp/example-repo", "/tmp/example-repo")).toBe(false);
  });
});
