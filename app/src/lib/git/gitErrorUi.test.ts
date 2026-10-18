import { describe, expect, it, vi } from "vitest";
import { GitCommandTimedOutError, GitNoUpstreamError } from "./gitService";
import { formatGitErrorPrimaryMessage, reportGitError } from "./gitErrorUi";
import {
  createGitCommandError,
  createGitInvalidPathError,
  createGitNotARepositoryError,
  type RunGitResponse,
} from "./types";

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

  it("maps pull conflicts reported only on stdout", () => {
    const error = createGitCommandError({
      exitCode: 1,
      stdout: "Auto-merging f\nCONFLICT (content): Merge conflict in f\nAutomatic merge failed; fix conflicts and then commit the result.\n",
      stderr: "From /tmp/remote\n * branch            main       -> FETCH_HEAD\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(error.stdout).toContain("CONFLICT");
    expect(formatGitErrorPrimaryMessage(error)).toContain("Merge conflict");
  });

  it("does not report a local index.lock permission error as an auth failure", () => {
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Unable to create '/tmp/repo/.git/index.lock': Permission denied\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    const message = formatGitErrorPrimaryMessage(error);
    expect(message).not.toContain("Authentication failed");
    expect(message).toContain("permission denied");
  });

  it("does not report a working-tree permission error as an auth failure", () => {
    const error = createGitCommandError({
      exitCode: 1,
      stdout: "",
      stderr: "error: unable to unlink old 'docs/a.md': Permission denied\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    const message = formatGitErrorPrimaryMessage(error);
    expect(message).not.toContain("Authentication failed");
    expect(message).toContain("Check file and folder permissions");
  });

  it("still maps remote permission denials to auth guidance", () => {
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "remote: Permission to org/repo.git denied to someone.\nfatal: unable to access 'https://example.com/org/repo.git/': The requested URL returned error: 403\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).not.toContain("Check file and folder permissions");
  });

  it("maps missing upstream errors", () => {
    const error = new GitNoUpstreamError('Branch "main" has no upstream.');
    expect(formatGitErrorPrimaryMessage(error)).toContain("no upstream");
  });

  it("maps timed-out git commands", () => {
    const error = new GitCommandTimedOutError();
    expect(formatGitErrorPrimaryMessage(error)).toContain("took too long");
  });

  it("maps index.lock failures with retry guidance", () => {
    const error = createGitCommandError({
      exitCode: 128,
      stdout: "",
      stderr: "fatal: Unable to create '/tmp/repo/.git/index.lock': File exists.\n",
      durationMs: 1,
    } satisfies RunGitResponse);

    expect(formatGitErrorPrimaryMessage(error)).toContain("index.lock");
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

  it("maps invalidPath git errors without [object Object]", () => {
    const error = createGitInvalidPathError("/tmp/ws", "repo_root must be an absolute path");
    expect(formatGitErrorPrimaryMessage(error)).toBe("repo_root must be an absolute path");
  });

  it("maps notARepository git errors without [object Object]", () => {
    const error = createGitNotARepositoryError("/tmp/ws", "fatal: not a git repository\n");
    expect(formatGitErrorPrimaryMessage(error)).toContain("not a git repository");
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
