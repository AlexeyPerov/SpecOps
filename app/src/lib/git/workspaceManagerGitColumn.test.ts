import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logDiagnostic } from "../services/logging";
import { checkGitAvailable, resolveRepoRoot } from "./gitService";
import { queryRepositoryStatusSummary } from "./repositoryStatusSummary";
import { notifyVersionControlMutation } from "./versionControlRefresh";
import {
  formatGitColumnDisplayText,
  loadWorkspaceGitColumnCell,
  refreshWorkspaceGitColumnCells,
  resetWorkspaceGitColumnQueueForTests,
  subscribeWorkspaceGitColumnAutoRefresh,
} from "./workspaceManagerGitColumn";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

vi.mock("./gitService", () => ({
  checkGitAvailable: vi.fn(),
  resolveRepoRoot: vi.fn(),
}));

vi.mock("./repositoryStatusSummary", () => ({
  queryRepositoryStatusSummary: vi.fn(),
}));

const checkGitAvailableMock = vi.mocked(checkGitAvailable);
const resolveRepoRootMock = vi.mocked(resolveRepoRoot);
const queryRepositoryStatusSummaryMock = vi.mocked(queryRepositoryStatusSummary);
const logDiagnosticMock = vi.mocked(logDiagnostic);

describe("formatGitColumnDisplayText", () => {
  it("renders branch, ahead/behind, and dirty marker", () => {
    expect(
      formatGitColumnDisplayText({
        branchName: "main",
        isDetached: false,
        aheadBehind: { ahead: 1, behind: 2 },
        isDirty: true,
      }),
    ).toBe("main · ↑1 ↓2 · dirty");
  });

  it("renders detached branch label", () => {
    expect(
      formatGitColumnDisplayText({
        branchName: "abc1234",
        isDetached: true,
        aheadBehind: null,
        isDirty: false,
      }),
    ).toBe("detached @ abc1234 · clean");
  });
});

describe("loadWorkspaceGitColumnCell", () => {
  beforeEach(() => {
    resetWorkspaceGitColumnQueueForTests();
    vi.clearAllMocks();
  });

  it("returns neutral placeholder for non-git workspaces", async () => {
    checkGitAvailableMock.mockResolvedValue({
      available: true,
      version: "git version 2.43.0",
      error: null,
    });
    resolveRepoRootMock.mockResolvedValue({
      ok: false,
      error: {
        kind: "notARepository",
        message: "not a git repository",
        workspaceRootPath: "/tmp/plain",
      },
    });

    await expect(loadWorkspaceGitColumnCell("/tmp/plain")).resolves.toEqual({
      status: "neutral",
      text: "—",
    });
  });

  it("returns ready cell with formatted summary for git workspaces", async () => {
    checkGitAvailableMock.mockResolvedValue({
      available: true,
      version: "git version 2.43.0",
      error: null,
    });
    resolveRepoRootMock.mockResolvedValue({
      ok: true,
      repoRoot: "/tmp/repo",
    });
    queryRepositoryStatusSummaryMock.mockResolvedValue({
      branchName: "feature",
      isDetached: false,
      aheadBehind: null,
      isDirty: false,
    });

    await expect(loadWorkspaceGitColumnCell("/tmp/repo")).resolves.toEqual({
      status: "ready",
      summary: {
        branchName: "feature",
        isDetached: false,
        aheadBehind: null,
        isDirty: false,
      },
      displayText: "feature · clean",
    });
  });

  it("returns neutral placeholder when git is unavailable", async () => {
    checkGitAvailableMock.mockResolvedValue({
      available: false,
      version: null,
      error: "missing",
    });

    await expect(loadWorkspaceGitColumnCell("/tmp/ws")).resolves.toEqual({
      status: "neutral",
      text: "—",
    });

    expect(resolveRepoRootMock).not.toHaveBeenCalled();
  });

  it("returns error placeholder without throwing when probe fails", async () => {
    checkGitAvailableMock.mockResolvedValue({
      available: true,
      version: "git version 2.43.0",
      error: null,
    });
    resolveRepoRootMock.mockResolvedValue({
      ok: true,
      repoRoot: "/tmp/repo",
    });
    queryRepositoryStatusSummaryMock.mockRejectedValue(new Error("git failed"));

    await expect(loadWorkspaceGitColumnCell("/tmp/repo")).resolves.toEqual({
      status: "error",
      text: "Git error",
      message: "git failed",
    });

    expect(logDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "Failed to load workspace git column cell",
        metadata: expect.objectContaining({
          workspaceRootPath: "/tmp/repo",
          operation: "loadWorkspaceGitColumnCell",
          error: "git failed",
        }),
      }),
    );
  });

  it("dedupes in-flight requests for the same workspace path", async () => {
    checkGitAvailableMock.mockResolvedValue({
      available: true,
      version: "git version 2.43.0",
      error: null,
    });
    resolveRepoRootMock.mockResolvedValue({
      ok: true,
      repoRoot: "/tmp/repo",
    });
    queryRepositoryStatusSummaryMock.mockResolvedValue({
      branchName: "main",
      isDetached: false,
      aheadBehind: null,
      isDirty: false,
    });

    const [first, second] = await Promise.all([
      loadWorkspaceGitColumnCell("/tmp/repo"),
      loadWorkspaceGitColumnCell("/tmp/repo"),
    ]);

    expect(first).toEqual(second);
    expect(queryRepositoryStatusSummaryMock).toHaveBeenCalledTimes(1);
  });
});

describe("refreshWorkspaceGitColumnCells", () => {
  beforeEach(() => {
    resetWorkspaceGitColumnQueueForTests();
    vi.clearAllMocks();
  });

  it("reloads each workspace concurrently", async () => {
    checkGitAvailableMock.mockResolvedValue({
      available: true,
      version: "git version 2.43.0",
      error: null,
    });
    resolveRepoRootMock.mockImplementation(async (path) => ({
      ok: true,
      repoRoot: path,
    }));

    const started: string[] = [];
    queryRepositoryStatusSummaryMock.mockImplementation(async (repoRoot) => {
      started.push(repoRoot);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        branchName: repoRoot.endsWith("a") ? "alpha" : "beta",
        isDetached: false,
        aheadBehind: null,
        isDirty: false,
      };
    });

    const refreshPromise = refreshWorkspaceGitColumnCells(["/tmp/a", "/tmp/b"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(started.sort()).toEqual(["/tmp/a", "/tmp/b"]);

    const results = await refreshPromise;

    expect(results.get("/tmp/a")).toMatchObject({ status: "ready", displayText: "alpha · clean" });
    expect(results.get("/tmp/b")).toMatchObject({ status: "ready", displayText: "beta · clean" });
    expect(queryRepositoryStatusSummaryMock).toHaveBeenCalledTimes(2);
  });
});

describe("subscribeWorkspaceGitColumnAutoRefresh", () => {
  beforeEach(() => {
    resetWorkspaceGitColumnQueueForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces forced refresh callbacks after version-control mutations", async () => {
    const refreshCalls: string[] = [];
    const unsubscribe = subscribeWorkspaceGitColumnAutoRefresh((workspaceRootPath) => {
      refreshCalls.push(workspaceRootPath);
    });

    notifyVersionControlMutation("/tmp/a", "stage");
    notifyVersionControlMutation("/tmp/a", "commit");
    notifyVersionControlMutation("/tmp/b", "pull");

    expect(refreshCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(300);

    expect(refreshCalls).toEqual(["/tmp/a", "/tmp/b"]);

    unsubscribe();
  });
});
