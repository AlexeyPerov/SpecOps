/**
 * Secret-redaction helpers for the session domain (phase B).
 *
 * Diagnostic events and `runtimeMetadata` may carry raw/native payloads for
 * debugging, but credentials must never reach persistence, logs, or exported
 * diagnostics. These helpers strip common secret shapes (bearer tokens, API
 * keys, authorization headers, passwords) and bound string size before a
 * value is serialized. Redaction is best-effort and conservative — when in
 * doubt, a value is dropped.
 */

import type { SessionEvent } from "./events";

const SECRET_KEY_PATTERNS = [
  /^authorization$/i,
  /^x-api-key$/i,
  /^api[-_]?key$/i,
  /secret$/i,
  /^password$/i,
  /token$/i,
  /^bearer$/i,
  /^(authUrl|verificationUrl|userCode|deviceCode|deviceAuthCode)$/i,
  /cookie$/i,
];

const SECRET_VALUE_PATTERNS = [
  /https?:\/\/[^\s?#]+\?[^\s]+/g,
  /Bearer\s+\S+/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}/g,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  /["\']?(?:[\w-]*token|[\w-]*secret|password|api[_-]?key|device[_-]?(?:code|auth[_-]?code)|user[_-]?code|authUrl|verificationUrl)["\']?\s*[=:]\s*["\']?[^\s,;}"\']+/gi,
  /((?:[\w-]*token|[\w-]*secret|password|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,
];

const MAX_STRING_LENGTH = 4_096;

export function redactSecretStringValue(value: string, maxLength = MAX_STRING_LENGTH): string {
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  if (redacted.length > maxLength) {
    return `${redacted.slice(0, maxLength)} …[redacted ${redacted.length - maxLength} chars]`;
  }
  return redacted;
}

export function redactForSerialization(value: unknown, maxStringLength = MAX_STRING_LENGTH): unknown {
  const seen = new WeakSet<object>();
  function redact(entry: unknown, depth: number): unknown {
    if (depth > 64) return "[redacted depth]";
    if (typeof entry === "string") return redactSecretStringValue(entry, maxStringLength);
    if (!entry || typeof entry !== "object") return entry;
    if (entry instanceof Date) return entry.toISOString();
    if (seen.has(entry)) return "[redacted cycle]";
    seen.add(entry);
    const out = Array.isArray(entry) ? entry.map((child) => redact(child, depth + 1)) : Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key)) ? "[redacted]" : redact(child, depth + 1)]));
    seen.delete(entry);
    return out;
  }
  return redact(value, 0);
}

/**
 * Coerce an unrecognized native event into a `diagnostic` event so it is
 * preserved for debugging rather than dropped or reinterpreted. The raw
 * payload is redacted first.
 */
export function toUnknownNativeDiagnostic(input: {
  nativeSessionId: SessionEvent["nativeSessionId"];
  seq: number;
  at: string;
  raw: unknown;
  message?: string;
}): Extract<SessionEvent, { type: "diagnostic" }> {
  return {
    type: "diagnostic",
    nativeSessionId: input.nativeSessionId,
    seq: input.seq,
    at: input.at,
    level: "info",
    reason: "unknown-native",
    message: redactSecretStringValue(input.message ?? "Unrecognized native event preserved as a diagnostic."),
    redactedRaw: redactForSerialization(input.raw),
  };
}

export function toMalformedDiagnostic(input: {
  nativeSessionId: SessionEvent["nativeSessionId"];
  seq: number;
  at: string;
  raw: unknown;
  message: string;
}): Extract<SessionEvent, { type: "diagnostic" }> {
  return {
    type: "diagnostic",
    nativeSessionId: input.nativeSessionId,
    seq: input.seq,
    at: input.at,
    level: "warn",
    reason: "malformed",
    message: redactSecretStringValue(input.message),
    redactedRaw: redactForSerialization(input.raw),
  };
}
