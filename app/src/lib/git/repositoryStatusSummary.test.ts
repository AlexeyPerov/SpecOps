import { beforeEach, describe, expect, it, vi } from "vitest";
import { logDiagnostic } from "../services/logging";
import { isWorkingTreeDirty, queryAheadBehind, queryCurrentBranch } from "./gitService";
import { queryRepositoryStatusSummary } from "./repositoryStatusSummary";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

vi.mock("./gitService", () => ({
  queryCurrentBranch: vi.fn(),
  queryAheadBehind: vi.fn(),
  isWorkingTreeDirty: vi.fn(),
}));

const queryCurrentBranchMock = vi.mocked(queryCurrentBranch);
const queryAheadBehindMock = vi.mocked(queryAheadBehind);
const isWorkingTreeDirtyMock = vi.mocked(isWorkingTreeDirty);
const logDiagnosticMock = vi.mocked(logDiagnostic);

describe("queryRepositoryStatusSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns branch, tracking, and dirty state for a tracked branch", async () => {
    queryCurrentBranchMock.mockResolvedValue({
      name: "main",
      isDetached: false,
      upstream: "origin/main",
    });
    isWorkingTreeDirtyMock.mockResolvedValue(true);
    queryAheadBehindMock.mockResolvedValue({ ahead: 2, behind: 1 });

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "main",
      isDetached: false,
      aheadBehind: { ahead: 2, behind: 1 },
      aheadBehindError: null,
      isDirty: true,
    });
  });

  it("skips ahead/behind for detached HEAD", async () => {
    queryCurrentBranchMock.mockResolvedValue({
      name: "abc1234",
      isDetached: true,
      upstream: null,
    });
    isWorkingTreeDirtyMock.mockResolvedValue(false);

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "abc1234",
      isDetached: true,
      aheadBehind: null,
      aheadBehindError: null,
      isDirty: false,
    });

    expect(queryAheadBehindMock).not.toHaveBeenCalled();
  });

  it("omits ahead/behind counts and logs when query fails", async () => {
    queryCurrentBranchMock.mockResolvedValue({
      name: "main",
      isDetached: false,
      upstream: "origin/main",
    });
    isWorkingTreeDirtyMock.mockResolvedValue(false);
    queryAheadBehindMock.mockRejectedValue(new Error("index.lock exists"));

    await expect(queryRepositoryStatusSummary("/tmp/repo")).resolves.toEqual({
      branchName: "main",
      isDetached: false,
      aheadBehind: null,
      aheadBehindError: "index.lock exists",
      isDirty: false,
    });

    expect(logDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Failed to query ahead/behind counts for workspace git column",
        metadata: expect.objectContaining({
          repoRoot: "/tmp/repo",
          error: "index.lock exists",
        }),
      }),
    );
  });
});
