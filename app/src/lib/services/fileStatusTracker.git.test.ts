import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapPorcelainStatusCodeToBadge,
  mapWorkingTreeStatusToAbsoluteBadges,
} from "../git/projectTreeFileStatusMap";
import { notifyVersionControlMutation } from "../git/versionControlRefresh";
import {
  refreshFileStatuses,
  resetFileStatusTrackerForTests,
  scheduleDebouncedFileStatusRefresh,
} from "./fileStatusTracker";

vi.mock("../git/gitService", () => ({
  resolveRepoRoot: vi.fn(),
  queryWorkingTreeStatus: vi.fn(),
}));

vi.mock("../git/gitIntegrationGating", () => ({
  shouldLoadProjectTreeGitBadges: vi.fn(() => true),
}));

import { queryWorkingTreeStatus, resolveRepoRoot } from "../git/gitService";
import { shouldLoadProjectTreeGitBadges } from "../git/gitIntegrationGating";

const resolveRepoRootMock = vi.mocked(resolveRepoRoot);
const queryWorkingTreeStatusMock = vi.mocked(queryWorkingTreeStatus);
const shouldLoadProjectTreeGitBadgesMock = vi.mocked(shouldLoadProjectTreeGitBadges);

describe("fileStatusTracker git integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFileStatusTrackerForTests();
    resolveRepoRootMock.mockReset();
    queryWorkingTreeStatusMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetFileStatusTrackerForTests();
  });

  it("loads badges from system git for git-backed workspaces", async () => {
    resolveRepoRootMock.mockResolvedValue({ ok: true, repoRoot: "/repo" });
    queryWorkingTreeStatusMock.mockResolvedValue({
      staged: [{ path: "staged.txt", indexStatus: "M", workTreeStatus: " ", statusCode: "M " }],
      unstaged: [
        { path: "new.txt", indexStatus: "?", workTreeStatus: "?", statusCode: "??" },
      ],
    });

    const state = await refreshFileStatuses({ workspaceRootPath: "/repo" });

    expect(state.source).toBe("git");
    expect(state.status).toBe("loaded");
    expect(state.statusByPath.get("/repo/staged.txt")).toBe("modified");
    expect(state.statusByPath.get("/repo/new.txt")).toBe("added");
  });

  it("debounces refresh after version-control mutations", async () => {
    resolveRepoRootMock.mockResolvedValue({ ok: true, repoRoot: "/repo" });
    queryWorkingTreeStatusMock.mockResolvedValue({
      staged: [],
      unstaged: [],
    });

    await refreshFileStatuses({ workspaceRootPath: "/repo" });
    expect(queryWorkingTreeStatusMock).toHaveBeenCalledTimes(1);

    notifyVersionControlMutation("/repo", "stage");
    await vi.advanceTimersByTimeAsync(149);
    expect(queryWorkingTreeStatusMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTicks();
    expect(queryWorkingTreeStatusMock).toHaveBeenCalledTimes(2);
  });

  it("schedules debounced refresh directly", async () => {
    resolveRepoRootMock.mockResolvedValue({ ok: true, repoRoot: "/repo" });
    queryWorkingTreeStatusMock.mockResolvedValue({ staged: [], unstaged: [] });

    scheduleDebouncedFileStatusRefresh("/repo");
    await vi.advanceTimersByTimeAsync(150);
    await vi.runAllTicks();

    expect(queryWorkingTreeStatusMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when a mutation lands during an in-flight refresh (M14)", async () => {
    resolveRepoRootMock.mockResolvedValue({ ok: true, repoRoot: "/repo" });
    queryWorkingTreeStatusMock.mockResolvedValue({ staged: [], unstaged: [] });

    // Hold the first fetch until we explicitly release it, so we can simulate
    // a mutation arriving mid-flight.
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    queryWorkingTreeStatusMock.mockImplementationOnce(async () => {
      await firstGate;
      return { staged: [], unstaged: [] };
    });

    // Kick off the first refresh (in flight, gated).
    const first = refreshFileStatuses({ workspaceRootPath: "/repo" });

    // While it's in flight, request another refresh. Previously this joined
    // the in-flight promise and the newer request was dropped, leaving stale
    // badges if a mutation landed in between.
    const second = refreshFileStatuses({ workspaceRootPath: "/repo" });

    // A follow-up should now be pending; release the first fetch.
    releaseFirst();
    await first;
    await second;
    await vi.runAllTicks();

    // Two fetches: the original plus the follow-up triggered by the in-flight
    // completion.
    expect(queryWorkingTreeStatusMock).toHaveBeenCalledTimes(2);
  });

  it("skips git probes when project-tree git badges are disabled", async () => {
    shouldLoadProjectTreeGitBadgesMock.mockReturnValue(false);

    const state = await refreshFileStatuses({
      workspaceRootPath: "/repo",
      allowOpencode: false,
    });

    expect(resolveRepoRootMock).not.toHaveBeenCalled();
    expect(queryWorkingTreeStatusMock).not.toHaveBeenCalled();
    expect(state.source).toBeNull();
    expect(state.statusByPath.size).toBe(0);
  });
});

describe("fileStatusTracker porcelain mapping reuse", () => {
  it("re-exports compatible badge statuses", () => {
    const badges = mapWorkingTreeStatusToAbsoluteBadges("/repo", {
      staged: [],
      unstaged: [
        { path: "x.ts", indexStatus: "?", workTreeStatus: "?", statusCode: "??" },
      ],
    });
    expect(badges.get("/repo/x.ts")).toBe(mapPorcelainStatusCodeToBadge("??"));
  });
});
