import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQueryCommitsArgs, isUnbornRepoLogError, queryCommits } from "./gitHistory";
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

describe("buildQueryCommitsArgs path filtering", () => {
  it("appends a literal pathspec after the revision separator", () => {
    const args = buildQueryCommitsArgs({ limit: 5, paths: ["src/main.ts"] });
    expect(args.slice(-2)).toEqual(["--", ":(literal)src/main.ts"]);
  });

  it("follows renames for a single file", () => {
    const args = buildQueryCommitsArgs({ paths: ["src/main.ts"], follow: true });
    expect(args).toContain("--follow");
    expect(args.indexOf("--follow")).toBeLessThan(args.indexOf("--"));
  });

  it("omits --follow for multiple paths (git rejects it)", () => {
    const args = buildQueryCommitsArgs({ paths: ["a.ts", "b.ts"], follow: true });
    expect(args).not.toContain("--follow");
    expect(args.slice(-3)).toEqual(["--", ":(literal)a.ts", ":(literal)b.ts"]);
  });

  it("adds no separator without paths", () => {
    expect(buildQueryCommitsArgs({ limit: 3 })).not.toContain("--");
  });

  it("ignores empty path entries", () => {
    expect(buildQueryCommitsArgs({ paths: [""] })).not.toContain("--");
  });
});
