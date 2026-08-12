/**
 * Protocol-level redaction (phase D, task AS01-D-04).
 *
 * Credentials and secret-shaped nested fields must never cross the diagnostic
 * boundary (stderr logs, error `data`, exported fixtures). The session domain
 * already redacts diagnostic payloads; this module applies the same recursive
 * redaction to anything the host writes to stderr and to protocol error data,
 * so secret canaries cannot leak through host diagnostics.
 */

import { redactForSerialization } from "../../src/lib/session";

export { redactForSerialization };

/** Redact an arbitrary value for safe logging/diagnostics. */
export function redactForLogs(value: unknown): unknown {
  return redactForSerialization(value);
}

/** Redact a JSON-RPC message before it is written to a diagnostic channel. */
export function redactMessage(message: unknown): unknown {
  return redactForSerialization(message);
}

const SECRET_CANARIES = [
  /Bearer\s+\S+/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
];

/**
 * Best-effort canary check used by tests: true when a value still contains a
 * recognizable secret shape after redaction (i.e. redaction failed). Production
 * code does not rely on this — it is a guard for the redaction suite.
 */
export function containsSecretCanary(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return SECRET_CANARIES.some((pattern) => pattern.test(text));
}
