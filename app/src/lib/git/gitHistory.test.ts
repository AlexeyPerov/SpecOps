import { beforeEach, describe, expect, it, vi } from "vitest";
import { isUnbornRepoLogError, queryCommits } from "./gitHistory";
import { resetGitCommandQueueForTests } from "./gitCommandQueue";
import { runGit } from "./gitRun";
import type { RunGitResponse } from "./types";

vi.mock("./gitRun", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gitRun")>();
  return {
    ...actual,
    runGit: vi.fn(),
  };
});

const runGitMock = vi.mocked(runGit);

function fatalUnbornResponse(): RunGitResponse {
  return {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: your current branch 'main' does not have any commits yet\n",
    durationMs: 1,
  };
}

function okResponse(stdout: string): RunGitResponse {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

describe("queryCommits", () => {
  beforeEach(() => {
    resetGitCommandQueueForTests();
    vi.clearAllMocks();
  });

  it("returns an empty list for an unborn repo instead of throwing the git fatal", async () => {
    runGitMock.mockResolvedValue(fatalUnbornResponse());

    await expect(queryCommits("/tmp/unborn")).resolves.toEqual([]);
  });

  it("throws for a genuine non-unborn git error", async () => {
    runGitMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: not a git repository\n",
      durationMs: 1,
    });

    await expect(queryCommits("/tmp/not-a-repo")).rejects.toThrow(/not a git repository/);
  });

  it("parses commits on a zero-exit response", async () => {
    runGitMock.mockResolvedValue(okResponse(""));

    await expect(queryCommits("/tmp/repo")).resolves.toEqual([]);
  });
});

describe("isUnbornRepoLogError", () => {
  it("detects the unborn-HEAD fatal", () => {
    expect(isUnbornRepoLogError(fatalUnbornResponse())).toBe(true);
  });

  it("returns false on a successful response", () => {
    expect(isUnbornRepoLogError(okResponse(""))).toBe(false);
  });

  it("returns false for an unrelated git fatal", () => {
    expect(
      isUnbornRepoLogError({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: not a git repository\n",
        durationMs: 1,
      }),
    ).toBe(false);
  });
});
