import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resetGitCommandQueueForTests } from "./gitCommandQueue";
import { runGit } from "./gitRun";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("runGit index.lock retry", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetGitCommandQueueForTests();
  });

  it("retries when git reports index.lock and then succeeds", async () => {
    invokeMock
      // First run_git fails with an index.lock error.
      .mockResolvedValueOnce({
        exitCode: 128,
        stdout: "",
        stderr: "fatal: Unable to create '/tmp/repo/.git/index.lock': File exists.",
        durationMs: 1,
      })
      // The retry path asks the backend to remove a stale lock before retrying.
      .mockResolvedValueOnce({ outcome: "removed" })
      // Second run_git succeeds.
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "ok\n",
        stderr: "",
        durationMs: 2,
      });

    const response = await runGit("/tmp/repo", ["status"]);

    expect(response.exitCode).toBe(0);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "remove_stale_index_lock", {
      request: { repoRoot: "/tmp/repo" },
    });
  });
});
