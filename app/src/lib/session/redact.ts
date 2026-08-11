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
  /^secret$/i,
  /^password$/i,
  /^token$/i,
  /^bearer$/i,
  /^set-cookie$/i,
];

const SECRET_VALUE_PATTERNS = [
  /Bearer\s+\S+/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
];

const MAX_STRING_LENGTH = 4_096;

export function redactSecretStringValue(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  if (redacted.length > MAX_STRING_LENGTH) {
    return `${redacted.slice(0, MAX_STRING_LENGTH)} …[redacted ${redacted.length - MAX_STRING_LENGTH} chars]`;
  }
  return redacted;
}

export function redactForSerialization(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretStringValue(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactForSerialization);
  }
  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value.toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactForSerialization(entry);
    }
    return out;
  }
  return value;
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
    message: input.message ?? "Unrecognized native event preserved as a diagnostic.",
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
    message: input.message,
    redactedRaw: redactForSerialization(input.raw),
  };
}
