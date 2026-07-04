import type { RunGitResponse } from "./types";

export class GitCommitFileDiffNotFoundError extends Error {
  readonly kind = "commitFileDiffNotFound" as const;
  readonly path: string;

  constructor(path: string) {
    super(`No diff found for path "${path}" in commit patch output.`);
    this.name = "GitCommitFileDiffNotFoundError";
    this.path = path;
  }
}

export class GitDiffTooLargeError extends Error {
  readonly kind = "diffTooLarge" as const;
  readonly path: string;
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(path: string, byteLength: number, maxBytes: number) {
    super(
      `Diff for "${path}" is too large to display (${byteLength} bytes; limit ${maxBytes}).`,
    );
    this.name = "GitDiffTooLargeError";
    this.path = path;
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

export class GitCommitValidationError extends Error {
  readonly kind = "commitValidation" as const;

  constructor(message: string) {
    super(message);
    this.name = "GitCommitValidationError";
  }
}

export class GitRefValidationError extends Error {
  readonly kind = "refValidation" as const;

  constructor(message: string) {
    super(message);
    this.name = "GitRefValidationError";
  }
}

export class GitNoUpstreamError extends Error {
  readonly kind = "noUpstream" as const;
  readonly branchName: string | null;

  constructor(message: string, branchName: string | null = null) {
    super(message);
    this.name = "GitNoUpstreamError";
    this.branchName = branchName;
  }
}

export class GitCommandCancelledError extends Error {
  readonly kind = "cancelled" as const;

  constructor(message = "Git command was cancelled.") {
    super(message);
    this.name = "GitCommandCancelledError";
  }
}

export class GitCommandTimedOutError extends Error {
  readonly kind = "timedOut" as const;

  constructor(message = "Git command timed out.") {
    super(message);
    this.name = "GitCommandTimedOutError";
  }
}

export class GitTagPartialDeleteError extends Error {
  readonly kind = "tagPartialDelete" as const;
  readonly failedRemotes: Array<{ remoteName: string; message: string }>;

  constructor(failedRemotes: Array<{ remoteName: string; message: string }>) {
    const names = failedRemotes.map((entry) => entry.remoteName).join(", ");
    super(`Tag deleted locally, but remote delete failed on: ${names}`);
    this.name = "GitTagPartialDeleteError";
    this.failedRemotes = failedRemotes;
  }
}

export class GitStashNothingToSaveError extends Error {
  readonly kind = "stashNothingToSave" as const;

  constructor(message = "No local changes to save.") {
    super(message);
    this.name = "GitStashNothingToSaveError";
  }
}

export class GitStashNotFoundError extends Error {
  readonly kind = "stashNotFound" as const;
  readonly stashRef: string;

  constructor(stashRef: string, message?: string) {
    super(message ?? `Stash "${stashRef}" was not found.`);
    this.name = "GitStashNotFoundError";
    this.stashRef = stashRef;
  }
}

export class GitStashApplyConflictError extends Error {
  readonly kind = "stashApplyConflict" as const;
  readonly stashRef: string;
  readonly stderr: string;

  constructor(stashRef: string, stderr: string) {
    super(`Could not apply stash "${stashRef}" because of conflicts.`);
    this.name = "GitStashApplyConflictError";
    this.stashRef = stashRef;
    this.stderr = stderr;
  }
}

export function isGitCommandCancelledError(error: unknown): error is GitCommandCancelledError {
  return error instanceof GitCommandCancelledError;
}

export function isGitCommandTimedOutError(error: unknown): error is GitCommandTimedOutError {
  return error instanceof GitCommandTimedOutError;
}

export function assertGitCommandCompleted(response: RunGitResponse): void {
  if (response.cancelled) {
    throw new GitCommandCancelledError();
  }
  if (response.timedOut) {
    throw new GitCommandTimedOutError();
  }
}
