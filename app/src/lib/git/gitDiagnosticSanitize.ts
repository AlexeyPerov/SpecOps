const REDACTED = "***";
const REDACTED_CREDENTIAL_URL = "***/";

const CREDENTIAL_URL_PATTERN = /https?:\/\/[^\s/@]+:[^\s/@]+@/gi;

const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(password|passwd|passphrase|token|secret|api[_-]?key)\b([=:])(\s*)(\S+)/gi;

const AUTHORIZATION_HEADER_PATTERN = /\bAuthorization:\s*\S+/gi;

/**
 * Redact likely credential material from git stderr before writing diagnostics.
 * Full stderr remains available to in-app error UI via {@link GitCommandError}.
 */
export function sanitizeGitStderrForDiagnosticLog(stderr: string): string {
  let sanitized = stderr.replace(CREDENTIAL_URL_PATTERN, REDACTED_CREDENTIAL_URL);
  sanitized = sanitized.replace(
    SENSITIVE_ASSIGNMENT_PATTERN,
    (_match, key: string, separator: string, whitespace: string) =>
      `${key}${separator}${whitespace}${REDACTED}`,
  );
  sanitized = sanitized.replace(AUTHORIZATION_HEADER_PATTERN, `Authorization: ${REDACTED}`);
  return sanitized;
}
