const REDACTED = "***";
const REDACTED_CREDENTIAL_URL = "***/";

/**
 * Credentials embedded in a URL's userinfo: `scheme://user:secret@host` for any
 * scheme, plus the username-only form `https://<token>@host` that hosting
 * providers accept for personal access tokens. A plain `ssh://git@host` (no
 * secret) is left readable.
 */
const CREDENTIAL_URL_PATTERN =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@|https?:\/\/[^\s/@:]+@)/gi;

/**
 * `key=value` / `key: value` pairs whose key ends in a sensitive word, so
 * prefixed query-string keys such as `access_token`, `private_token` or
 * `client_secret` match too. The value stops at whitespace, `&` (next query
 * parameter) and quotes.
 */
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_-]*?(?:password|passwd|passphrase|token|secret|api[_-]?key))\b([=:])(\s*)([^\s&"']+)/gi;

/** Auth headers, including the scheme word (`Bearer`, `Basic`, …) and the credential after it. */
const AUTHORIZATION_HEADER_PATTERN =
  /\b(Authorization|Proxy-Authorization):[ \t]*(?:(?:Bearer|Basic|Digest|Negotiate|token)[ \t]+)?\S+/gi;

/**
 * Redact likely credential material from git stderr before writing diagnostics.
 * Full stderr remains available to in-app error UI via {@link GitCommandError}.
 */
export function sanitizeGitStderrForDiagnosticLog(stderr: string): string {
  let sanitized = stderr.replace(CREDENTIAL_URL_PATTERN, REDACTED_CREDENTIAL_URL);
  sanitized = sanitized.replace(
    AUTHORIZATION_HEADER_PATTERN,
    (_match, header: string) => `${header}: ${REDACTED}`,
  );
  sanitized = sanitized.replace(
    SENSITIVE_ASSIGNMENT_PATTERN,
    (_match, key: string, separator: string, whitespace: string) =>
      `${key}${separator}${whitespace}${REDACTED}`,
  );
  return sanitized;
}
