import { beforeEach, describe, expect, it, vi } from "vitest";
import { isWorkingTreeDirty, queryAheadBehind, queryCurrentBranch } from "./gitService";
import { queryRepositoryStatusSummary } from "./repositoryStatusSummary";

vi.mock("./gitService", () => ({
  queryCurrentBranch: vi.fn(),
  queryAheadBehind: vi.fn(),
  isWorkingTreeDirty: vi.fn(),
}));

const queryCurrentBranchMock = vi.mocked(queryCurrentBranch);
const queryAheadBehindMock = vi.mocked(queryAheadBehind);
const isWorkingTreeDirtyMock = vi.mocked(isWorkingTreeDirty);

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
      isDirty: false,
    });

    expect(queryAheadBehindMock).not.toHaveBeenCalled();
  });
});
