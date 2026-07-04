import { describe, expect, it, vi } from "vitest";
import { GitCommandCancelledError } from "./gitService";
import { isGitCancellationError, notifyGitCancellation } from "./gitErrorUi";
import { logDiagnostic } from "../services/logging";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

describe("git cancellation UI", () => {
  it("detects GitCommandCancelledError", () => {
    expect(isGitCancellationError(new GitCommandCancelledError())).toBe(true);
    expect(isGitCancellationError(new Error("other"))).toBe(false);
  });

  it("notifies cancellation as informational toast text", () => {
    const notify = vi.fn();
    notifyGitCancellation("Fetch", { notify, repoRoot: "/tmp/repo" });

    expect(notify).toHaveBeenCalledWith("Fetch cancelled.");
    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "info",
        message: "Fetch cancelled.",
        metadata: expect.objectContaining({
          operation: "Fetch",
          cancelled: true,
          repoRoot: "/tmp/repo",
        }),
      }),
    );
  });
});
