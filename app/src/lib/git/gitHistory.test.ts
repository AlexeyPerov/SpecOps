import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildQueryCommitsArgs, isUnbornRepoLogError, queryCommitFileDiff, queryCommits, resolveHistoryCommit } from "./gitHistory";
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


describe("repository-wide history resolution", () => {
  it("resolves refs and SHA outside any page with option-safe argv", async () => {
    const sha = "c".repeat(40);
    runGitMock.mockResolvedValue(okResponse(sha + "\n"));
    await expect(resolveHistoryCommit("/repo", "feature/old")).resolves.toBe(sha);
    expect(runGitMock).toHaveBeenLastCalledWith("/repo", ["rev-parse", "--verify", "--end-of-options", "feature/old^{commit}"], "versionControl");
    await resolveHistoryCommit("/repo", "--output=bad");
    expect(runGitMock.mock.calls.at(-1)?.[1]).toEqual(["rev-parse", "--verify", "--end-of-options", "--output=bad^{commit}"]);
  });
  it("rejects invalid or unresolved commits without inventing a page miss", async () => {
    runGitMock.mockResolvedValue({ ...okResponse(""), exitCode:128, stderr:"Unknown revision" });
    await expect(resolveHistoryCommit("/repo", "missing")).rejects.toBeTruthy();
  });
  it("supports backend ordering and optional remote scope", () => {
    expect(buildQueryCommitsArgs({order:"topological",includeRemotes:true})).toContain("--topo-order");
    expect(buildQueryCommitsArgs({order:"date",includeRemotes:true})).toContain("--date-order");
    expect(buildQueryCommitsArgs({includeRemotes:true})).toContain("--remotes");
  });
});

describe("queryCommitFileDiff renames", () => {
  beforeEach(() => {
    resetGitCommandQueueForTests();
    vi.clearAllMocks();
  });

  const renameDiff = [
    "diff --git a/f.txt b/g h.txt",
    "similarity index 100%",
    "rename from f.txt",
    "rename to g h.txt",
    "",
  ].join("\n");

  it("includes the previous path in the pathspec so git pairs the rename", async () => {
    runGitMock.mockResolvedValue(okResponse(renameDiff));

    const diff = await queryCommitFileDiff("/repo", "b".repeat(40), "g h.txt", "a".repeat(40), "versionControl", "f.txt");

    const args = runGitMock.mock.calls[0]![1];
    expect(args).toContain("--find-renames");
    expect(args.slice(args.indexOf("--") + 1)).toEqual([":(literal)g h.txt", ":(literal)f.txt"]);
    expect(diff).toMatchObject({ path: "g h.txt", oldPath: "f.txt", hunks: [] });
  });

  it("keeps a single pathspec without a previous path", async () => {
    runGitMock.mockResolvedValue(okResponse("diff --git a/x.txt b/x.txt\nindex 1..2 100644\n--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n"));

    await queryCommitFileDiff("/repo", "b".repeat(40), "x.txt", "a".repeat(40));

    const args = runGitMock.mock.calls[0]![1];
    expect(args.slice(args.indexOf("--") + 1)).toEqual([":(literal)x.txt"]);
  });
});
