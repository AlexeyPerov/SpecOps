import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  cancelGitCommand,
  fetchRemote,
  GitCommandCancelledError,
  GitCommandTimedOutError,
  isGitCommandCancelledError,
  isGitCommandTimedOutError,
  LOCAL_GIT_OPERATION_TIMEOUT_MS,
  pullRemote,
  pushRemote,
  REMOTE_GIT_OPERATION_TIMEOUT_MS,
  runGit,
} from "./gitService";
import { isGitError } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const REMOTE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
};

function expectRunGitPayload(partial: Record<string, unknown>) {
  return expect.objectContaining({
    request: expect.objectContaining(partial),
  });
}

describe("cancelGitCommand", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes cancel_git_command with the command id", async () => {
    invokeMock.mockResolvedValue({ outcome: "cancelled" });

    const response = await cancelGitCommand("cmd-123");

    expect(invokeMock).toHaveBeenCalledWith("cancel_git_command", {
      commandId: "cmd-123",
    });
    expect(response.outcome).toBe("cancelled");
  });

  it("returns alreadyFinished without throwing", async () => {
    invokeMock.mockResolvedValue({ outcome: "alreadyFinished" });

    const response = await cancelGitCommand("cmd-done");

    expect(response.outcome).toBe("alreadyFinished");
  });

  it("returns notFound for unknown ids", async () => {
    invokeMock.mockResolvedValue({ outcome: "notFound" });

    const response = await cancelGitCommand("missing");

    expect(response.outcome).toBe("notFound");
  });
});

describe("cancellable remote operations", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("passes commandId through run_git for fetchRemote", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 10,
      cancelled: false,
    });

    await fetchRemote("/tmp/repo", undefined, { commandId: "fetch-1" });

    expect(invokeMock).toHaveBeenCalledWith(
      "run_git",
      expectRunGitPayload({
        repoRoot: "/tmp/repo",
        args: ["fetch"],
        commandId: "fetch-1",
        askpassEnabled: true,
        askpassOperation: "fetch",
        timeoutMs: REMOTE_GIT_OPERATION_TIMEOUT_MS,
        env: REMOTE_GIT_ENV,
      }),
    );
  });

  it("throws GitCommandCancelledError when fetch response is cancelled", async () => {
    invokeMock.mockResolvedValue({
      exitCode: -1,
      stdout: "",
      stderr: "terminated",
      durationMs: 10,
      cancelled: true,
    });

    await expect(fetchRemote("/tmp/repo", undefined, { commandId: "fetch-2" })).rejects.toSatisfy(
      (error) => isGitCommandCancelledError(error),
    );
  });

  it("throws GitCommandCancelledError for cancelled pull and push", async () => {
    invokeMock.mockResolvedValue({
      exitCode: -1,
      stdout: "",
      stderr: "",
      durationMs: 5,
      cancelled: true,
    });

    await expect(pullRemote("/tmp/repo", undefined, { commandId: "pull-1" })).rejects.toBeInstanceOf(
      GitCommandCancelledError,
    );
    await expect(pushRemote("/tmp/repo", undefined, { commandId: "push-1" })).rejects.toBeInstanceOf(
      GitCommandCancelledError,
    );
  });

  it("still throws GitCommandError for non-cancel failures", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: remote error",
      durationMs: 5,
      cancelled: false,
    });

    await expect(fetchRemote("/tmp/repo", undefined, { commandId: "fetch-3" })).rejects.toSatisfy(
      (error) => isGitError(error) && error.kind === "command" && error.exitCode === 128,
    );
  });

  it("passes commandId through runGit options", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "ok\n",
      stderr: "",
      durationMs: 1,
    });

    await runGit("/tmp/repo", ["status"], undefined, { commandId: "status-1" });

    expect(invokeMock).toHaveBeenCalledWith(
      "run_git",
      expectRunGitPayload({
        repoRoot: "/tmp/repo",
        args: ["status"],
        commandId: "status-1",
        timeoutMs: LOCAL_GIT_OPERATION_TIMEOUT_MS,
      }),
    );
  });

  it("passes default timeoutMs for remote fetch operations", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 10,
      cancelled: false,
    });

    await fetchRemote("/tmp/repo", undefined, { commandId: "fetch-4" });

    expect(invokeMock).toHaveBeenCalledWith(
      "run_git",
      expectRunGitPayload({
        repoRoot: "/tmp/repo",
        args: ["fetch"],
        commandId: "fetch-4",
        askpassEnabled: true,
        askpassOperation: "fetch",
        timeoutMs: REMOTE_GIT_OPERATION_TIMEOUT_MS,
        env: REMOTE_GIT_ENV,
      }),
    );
  });

  it("throws GitCommandTimedOutError when fetch response is timed out", async () => {
    invokeMock.mockResolvedValue({
      exitCode: -1,
      stdout: "",
      stderr: "Git command timed out.",
      durationMs: 600_000,
      timedOut: true,
    });

    await expect(fetchRemote("/tmp/repo", undefined, { commandId: "fetch-5" })).rejects.toSatisfy(
      (error) => isGitCommandTimedOutError(error),
    );
  });
});
