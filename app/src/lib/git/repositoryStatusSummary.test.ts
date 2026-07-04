import { beforeEach, describe, expect, it, vi } from "vitest";
import { logDiagnostic } from "../services/logging";
import { runGit } from "./gitService";
import { queryRepositoryStatusSummary } from "./repositoryStatusSummary";
import { resetGitCommandQueueForTests } from "./gitCommandQueue";
import type { RunGitResponse } from "./types";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

vi.mock("./gitService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gitService")>();
  return {
    ...actual,
    runGit: vi.fn(),
  };
});

const runGitMock = vi.mocked(runGit);
const logDiagnosticMock = vi.mocked(logDiagnostic);

function statusResponse(stdout: string): RunGitResponse {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
  };
}

describe("queryRepositoryStatusSummary", () => {
  beforeEach(() => {
    resetGitCommandQueueForTests();
    vi.clearAllMocks();
  });

  it("returns branch, tracking, and dirty state for a tracked branch", async () => {
    runGitMock.mockResolvedValue(
      statusResponse("## main...origin/main [ahead 2, behind 1]\n M file.txt\n"),
    );

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "main",
      isDetached: false,
      aheadBehind: { ahead: 2, behind: 1 },
      aheadBehindError: null,
      isDirty: true,
    });

    expect(runGitMock).toHaveBeenCalledTimes(1);
    expect(runGitMock).toHaveBeenCalledWith("/tmp/repo", ["status", "-sb"]);
  });

  it("uses zero counts when upstream exists without ahead/behind bracket", async () => {
    runGitMock.mockResolvedValue(statusResponse("## main...origin/main\n"));

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "main",
      isDetached: false,
      aheadBehind: { ahead: 0, behind: 0 },
      aheadBehindError: null,
      isDirty: false,
    });
  });

  it("resolves detached HEAD with a follow-up rev-parse call", async () => {
    runGitMock
      .mockResolvedValueOnce(statusResponse("## HEAD (no branch)\n"))
      .mockResolvedValueOnce(statusResponse("abc1234\n"));

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "abc1234",
      isDetached: true,
      aheadBehind: null,
      aheadBehindError: null,
      isDirty: false,
    });

    expect(runGitMock).toHaveBeenNthCalledWith(1, "/tmp/repo", ["status", "-sb"]);
    expect(runGitMock).toHaveBeenNthCalledWith(2, "/tmp/repo", ["rev-parse", "--short", "HEAD"]);
  });

  it("omits ahead/behind when upstream is gone", async () => {
    runGitMock.mockResolvedValue(statusResponse("## main...origin/main [gone]\n"));

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "main",
      isDetached: false,
      aheadBehind: null,
      aheadBehindError: null,
      isDirty: false,
    });

    expect(logDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Upstream branch is gone; omitting ahead/behind counts",
      }),
    );
  });
});
