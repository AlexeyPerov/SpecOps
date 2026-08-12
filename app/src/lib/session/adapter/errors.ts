/**
 * Typed adapter errors (phase C).
 *
 * Adapters translate vendor failures into these typed errors so the host (phase
 * D) can map them to deterministic protocol error codes without inspecting
 * vendor exception text. Every mandatory method documents which codes it may
 * raise; the contract suite asserts that cancellation always surfaces as the
 * `cancelled` code rather than a generic runtime failure.
 *
 * `cause` may carry a vendor error for host-side diagnostics; it is redacted
 * before it crosses the diagnostic boundary (phase D).
 */

export type AdapterErrorCode =
  /** Authentication is required before the operation can proceed. */
  | "authentication-required"
  /** Authentication was attempted and rejected by the runtime. */
  | "authentication-failed"
  /** The referenced native session does not exist (or has expired). */
  | "session-not-found"
  /** The referenced turn does not exist. */
  | "turn-not-found"
  /** A turn is not currently active for the session (nothing to cancel/stream). */
  | "turn-not-active"
  /** The adapter advertised a capability/extension it does not implement. */
  | "capability-not-supported"
  /** The in-flight turn/stream was cancelled by the caller. */
  | "cancelled"
  /** The runtime binary/process is missing, unreachable, or crashed. */
  | "runtime-unavailable"
  /** The adapter received a malformed vendor payload it could not normalize. */
  | "malformed-event"
  /** Unclassified adapter-internal failure. */
  | "internal";

export interface AdapterErrorOptions {
  readonly cause?: unknown;
  readonly data?: Readonly<Record<string, unknown>>;
}

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly data?: Readonly<Record<string, unknown>>;

  constructor(code: AdapterErrorCode, message: string, options?: AdapterErrorOptions) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    if (options?.data !== undefined) {
      this.data = options.data;
    }
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isAdapterError(value: unknown): value is AdapterError {
  return value instanceof AdapterError;
}

export function adapterError(
  code: AdapterErrorCode,
  message: string,
  options?: AdapterErrorOptions,
): AdapterError {
  return new AdapterError(code, message, options);
}

export function isAdapterErrorCode(value: unknown, code: AdapterErrorCode): boolean {
  return isAdapterError(value) && value.code === code;
}

/** Factory helpers for the most common codes. */
export const adapterErrors = {
  authenticationRequired: (message = "Authentication required", options?: AdapterErrorOptions) =>
    adapterError("authentication-required", message, options),
  authenticationFailed: (message = "Authentication failed", options?: AdapterErrorOptions) =>
    adapterError("authentication-failed", message, options),
  sessionNotFound: (nativeSessionId: string, options?: AdapterErrorOptions) =>
    adapterError("session-not-found", `Native session not found: ${nativeSessionId}`, options),
  turnNotFound: (turnId: string, options?: AdapterErrorOptions) =>
    adapterError("turn-not-found", `Turn not found: ${turnId}`, options),
  turnNotActive: (nativeSessionId: string, options?: AdapterErrorOptions) =>
    adapterError("turn-not-active", `No active turn for session: ${nativeSessionId}`, options),
  capabilityNotSupported: (capability: string, options?: AdapterErrorOptions) =>
    adapterError("capability-not-supported", `Capability not supported: ${capability}`, options),
  cancelled: (message = "Turn cancelled", options?: AdapterErrorOptions) =>
    adapterError("cancelled", message, options),
  runtimeUnavailable: (message = "Runtime unavailable", options?: AdapterErrorOptions) =>
    adapterError("runtime-unavailable", message, options),
  malformedEvent: (message: string, options?: AdapterErrorOptions) =>
    adapterError("malformed-event", message, options),
  internal: (message = "Internal adapter error", options?: AdapterErrorOptions) =>
    adapterError("internal", message, options),
};
