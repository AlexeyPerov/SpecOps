import { logDiagnostic } from "../services/logging";
import { GitNoUpstreamError } from "./gitService";
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
 * Map common git failures to a short, human-readable primary message.
 */
export function formatGitErrorPrimaryMessage(error: unknown): string {
  if (error instanceof GitNoUpstreamError) {
    return error.message;
  }

  if (isGitError(error) && error.kind === "command") {
    const stderr = commandErrorStderr(error).toLowerCase();

    if (stderr.includes("authentication failed") || stderr.includes("permission denied")) {
      return "Authentication failed. Check your credentials and try again.";
    }

    if (
      stderr.includes("merge conflict") ||
      stderr.includes("overwritten by merge") ||
      stderr.includes("unmerged files") ||
      stderr.includes("needs merge")
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

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.toLowerCase().includes("not a git command")) {
      return "Git command failed. Verify git is installed and available on PATH.";
    }
    return message || "Git operation failed.";
  }

  return String(error);
}

function extractStderr(error: unknown): string | undefined {
  if (isGitError(error) && error.kind === "command") {
    const stderr = commandErrorStderr(error);
    return stderr || undefined;
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
