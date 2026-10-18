import { logDiagnostic } from "../services/logging";
import { GitNoUpstreamError, isGitCommandCancelledError, isGitCommandTimedOutError } from "./gitService";
import { combinedGitOutput, isGitConflictOutput } from "./gitErrors";
import { isGitError, type GitCommandError } from "./types";

export interface ReportGitErrorOptions {
  operation: string;
  repoRoot?: string;
  notify?: (message: string) => void;
}

function firstMeaningfulLine(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? text.trim();
}

function commandErrorStderr(error: GitCommandError): string {
  return error.stderr.trim();
}

/**
 * True when "permission denied" comes from the local filesystem (git could not
 * create, open, write or unlink a file) rather than from a remote server.
 */
function isLocalFilesystemPermissionStderr(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  if (!lower.includes("permission denied") && !lower.includes("insufficient permission")) {
    return false;
  }
  return (
    lower.includes("insufficient permission") ||
    lower.includes("unable to create") ||
    lower.includes("unable to unlink") ||
    lower.includes("unable to write") ||
    lower.includes("unable to open") ||
    lower.includes("could not open") ||
    lower.includes("cannot open") ||
    lower.includes("could not write") ||
    lower.includes("failed to write") ||
    lower.includes("unable to rename") ||
    lower.includes("cannot create directory") ||
    lower.includes("could not create")
  );
}

function isAuthRelatedStderr(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  if (isLocalFilesystemPermissionStderr(lower)) {
    return false;
  }
  return (
    lower.includes("authentication failed") ||
    lower.includes("permission denied") ||
    lower.includes("could not read username") ||
    lower.includes("could not read password") ||
    lower.includes("terminal prompts disabled") ||
    lower.includes("could not authenticate") ||
    lower.includes("invalid username or password") ||
    lower.includes("access denied") ||
    lower.includes("host key verification failed") ||
    lower.includes("publickey") ||
    lower.includes("no supported authentication methods") ||
    lower.includes("failed to authenticate") ||
    lower.includes("credential")
  );
}

function authFailureGuidance(stderr: string): string {
  const lower = stderr.toLowerCase();
  if (lower.includes("publickey") || lower.includes("permission denied (publickey")) {
    return "SSH authentication failed. Check your SSH key, agent, and remote access.";
  }
  if (lower.includes("host key verification failed")) {
    return "SSH host key verification failed. Verify the remote host fingerprint.";
  }
  if (lower.includes("terminal prompts disabled")) {
    return "Git could not prompt for credentials. Sign in via the credential prompt or configure a credential helper.";
  }
  return "Authentication failed. Check your credentials, SSH agent, or credential helper and try again.";
}

/**
 * Map common git failures to a short, human-readable primary message.
 */
export function formatGitErrorPrimaryMessage(error: unknown): string {
  if (error instanceof GitNoUpstreamError) {
    return error.message;
  }

  if (isGitCommandTimedOutError(error)) {
    return "The git command took too long and was stopped. Check your network connection and try again.";
  }

  if (isGitError(error) && error.kind === "command") {
    const stderr = commandErrorStderr(error).toLowerCase();
    // Conflict details (`CONFLICT (...)`, "Automatic merge failed") go to stdout.
    const combined = combinedGitOutput(error).toLowerCase();

    // Lock and local-permission failures are checked before auth: their stderr
    // also contains "permission denied" / "unable to create", which must not be
    // reported as a credentials problem.
    if (
      stderr.includes("index.lock") ||
      (stderr.includes("unable to create") && stderr.includes("lock"))
    ) {
      if (stderr.includes("permission denied")) {
        return "Git could not write the repository lock file (permission denied). Check file and folder permissions for this repository.";
      }
      return "Another git operation may still be running. Wait a moment and try again, or remove .git/index.lock if no git process is active.";
    }

    if (isLocalFilesystemPermissionStderr(stderr)) {
      return "Git could not write to the working tree or repository (permission denied). Check file and folder permissions.";
    }

    if (isAuthRelatedStderr(stderr)) {
      return authFailureGuidance(stderr);
    }

    if (
      isGitConflictOutput(combined) ||
      combined.includes("overwritten by merge") ||
      combined.includes("unmerged files") ||
      combined.includes("needs merge")
    ) {
      return "Merge conflict or local changes would be overwritten. Resolve conflicts and try again.";
    }

    if (stderr.includes("not a git command") || stderr.includes("is not recognized as an internal or external command")) {
      return "Git command failed. Verify git is installed and available on PATH.";
    }

    const raw = commandErrorStderr(error);
    if (raw) {
      return firstMeaningfulLine(raw);
    }

    return error.message;
  }

  if (isGitError(error)) {
    return error.message.trim() || "Git operation failed.";
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.toLowerCase().includes("not a git command")) {
      return "Git command failed. Verify git is installed and available on PATH.";
    }
    return message || "Git operation failed.";
  }

  return String(error);
}

/**
 * Surface a user-initiated git cancellation as an informational toast (not an error).
 */
export function notifyGitCancellation(
  operation: string,
  options: Pick<ReportGitErrorOptions, "notify" | "repoRoot"> = {},
): void {
  const toast = `${operation} cancelled.`;

  void logDiagnostic({
    level: "info",
    source: "frontend",
    message: toast,
    timestamp: new Date().toISOString(),
    metadata: {
      operation,
      cancelled: true,
      ...(options.repoRoot ? { repoRoot: options.repoRoot } : {}),
    },
  });

  options.notify?.(toast);
}

export function isGitCancellationError(error: unknown): boolean {
  return isGitCommandCancelledError(error);
}

export function isGitTimeoutError(error: unknown): boolean {
  return isGitCommandTimedOutError(error);
}

function extractStderr(error: unknown): string | undefined {
  if (isGitError(error) && error.kind === "command") {
    const stderr = commandErrorStderr(error);
    return stderr || undefined;
  }
  if (isGitError(error)) {
    return error.message.trim() || undefined;
  }
  if (error instanceof Error) {
    return error.message || undefined;
  }
  return undefined;
}

/**
 * Surface a git failure in the status bar (when `notify` is provided) and log
 * full stderr to the app console for diagnostics.
 */
export function reportGitError(error: unknown, options: ReportGitErrorOptions): string {
  const primary = formatGitErrorPrimaryMessage(error);
  const stderr = extractStderr(error);
  const toast = `${options.operation} failed: ${primary}`;

  void logDiagnostic({
    level: "error",
    source: "frontend",
    message: toast,
    timestamp: new Date().toISOString(),
    metadata: {
      operation: options.operation,
      ...(options.repoRoot ? { repoRoot: options.repoRoot } : {}),
      ...(stderr ? { stderr } : {}),
      ...(isGitError(error) && error.kind === "command" ? { exitCode: error.exitCode } : {}),
    },
  });

  options.notify?.(toast);
  return primary;
}
