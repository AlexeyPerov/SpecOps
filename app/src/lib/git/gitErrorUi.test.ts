import { describe, expect, it, vi } from "vitest";
import { GitNoUpstreamError } from "./gitService";
import { formatGitErrorPrimaryMessage, reportGitError } from "./gitErrorUi";
import { createGitCommandError, type RunGitResponse } from "./types";

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn(),
}));

import { logDiagnostic } from "../services/logging";

const logDiagnosticMock = vi.mocked(logDiagnostic);

describe("formatGitErrorPrimaryMessage", () => {
  it("maps authentication failures", () => {
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Authentication failed for 'https://example.com/repo.git/'\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).toContain("Authentication failed");
  });

  it("maps SSH publickey failures", () => {
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "git@github.com: Permission denied (publickey).\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).toContain("SSH authentication failed");
  });

  it("maps terminal prompt disabled failures", () => {
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: could not read Username for 'https://example.com': terminal prompts disabled\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).toContain("could not prompt for credentials");
  });

  it("maps merge conflicts", () => {
    const error = createGitCommandError({
      exitCode: 1,
      stdout: "",
      stderr: "error: Your local changes to the following files would be overwritten by merge:\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).toContain("Merge conflict");
  });

  it("maps missing upstream errors", () => {
    const error = new GitNoUpstreamError('Branch "main" has no upstream.');
    expect(formatGitErrorPrimaryMessage(error)).toContain("no upstream");
  });

  it("maps not-a-git-command failures", () => {
    const error = createGitCommandError({
      exitCode: 1,
      stdout: "",
      stderr: "git: 'statusx' is not a git command. See 'git --help'.\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).toContain("Git command failed");
  });
});

describe("reportGitError", () => {
  it("notifies and logs stderr to the console", () => {
    logDiagnosticMock.mockClear();
    const notify = vi.fn();
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Authentication failed for 'https://example.com/repo.git/'\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    const primary = reportGitError(error, {
      operation: "Push",
      repoRoot: "/tmp/repo",
      notify,
    });

    expect(primary).toContain("Authentication failed");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Push failed"));
    expect(logDiagnosticMock).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        metadata: expect.objectContaining({
          stderr: expect.stringContaining("Authentication failed"),
          repoRoot: "/tmp/repo",
        }),
      }),
    );
  });
});
