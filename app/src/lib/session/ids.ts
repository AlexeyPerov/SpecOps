/**
 * Branded session/turn identifiers (phase B domain).
 *
 * SpecOps ids and native ids are both strings on the wire, but they must not
 * be confusable at the API surface: passing a native session id where a
 * SpecOps session id is expected (or vice-versa) is a category error that
 * silent `string` typing would allow. Each id type carries a unique-symbol
 * brand, so TypeScript rejects cross-assignment and call-site mismatch. The
 * brands are compile-time only — at runtime each value is the validated
 * string.
 *
 * Id minting format (stable, deterministic for fixtures):
 * - SpecOps session id: `sos-session-{n}`
 * - SpecOps turn id:    `sos-turn-{n}`
 * - Native session id:  opaque, runtime-supplied (validated non-empty)
 */

declare const specOpsSessionIdBrand: unique symbol;
declare const specOpsTurnIdBrand: unique symbol;
declare const nativeSessionIdBrand: unique symbol;

/** SpecOps-owned session identity. Minted by SpecOps, never supplied by a runtime. */
export type SpecOpsSessionId = string & { readonly [specOpsSessionIdBrand]: void };

/** SpecOps-owned turn identity (one user prompt → one assistant turn). */
export type SpecOpsTurnId = string & { readonly [specOpsTurnIdBrand]: void };

/** Runtime-native session identity. Opaque to SpecOps beyond equality + replay. */
export type NativeSessionId = string & { readonly [nativeSessionIdBrand]: void };

export class SessionIdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionIdParseError";
  }
}

function assertNonEmptyId(raw: string, kind: string): void {
  if (typeof raw !== "string") {
    throw new SessionIdParseError(`${kind} must be a string`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new SessionIdParseError(`${kind} must not be empty`);
  }
  if (trimmed.length > 256) {
    throw new SessionIdParseError(`${kind} must not exceed 256 characters`);
  }
}

let specOpsSessionIdCounter = 0;
let specOpsTurnIdCounter = 0;

/** Mint the next SpecOps session id. Deterministic counter resets via {@link resetSessionIdCountersForTests}. */
export function mintSpecOpsSessionId(): SpecOpsSessionId {
  specOpsSessionIdCounter += 1;
  return `sos-session-${specOpsSessionIdCounter}` as SpecOpsSessionId;
}

/** Mint the next SpecOps turn id. */
export function mintSpecOpsTurnId(): SpecOpsTurnId {
  specOpsTurnIdCounter += 1;
  return `sos-turn-${specOpsTurnIdCounter}` as SpecOpsTurnId;
}

/** Wrap a persisted/external SpecOps session id after validation. */
export function asSpecOpsSessionId(raw: string): SpecOpsSessionId {
  assertNonEmptyId(raw, "SpecOpsSessionId");
  return raw as SpecOpsSessionId;
}

/** Wrap a persisted/external SpecOps turn id after validation. */
export function asSpecOpsTurnId(raw: string): SpecOpsTurnId {
  assertNonEmptyId(raw, "SpecOpsTurnId");
  return raw as SpecOpsTurnId;
}

/** Wrap a runtime-supplied native session id after validation. */
export function asNativeSessionId(raw: string): NativeSessionId {
  assertNonEmptyId(raw, "NativeSessionId");
  return raw as NativeSessionId;
}

/** Test-only: reset the SpecOps id counters so fixture ids are deterministic. */
export function resetSessionIdCountersForTests(): void {
  specOpsSessionIdCounter = 0;
  specOpsTurnIdCounter = 0;
}

/** Re-sync the SpecOps id counter to a restored high-water mark (inclusive). */
export function reindexSpecOpsSessionIdCounter(largestNumericSuffix: number): void {
  if (Number.isFinite(largestNumericSuffix) && largestNumericSuffix >= 0) {
    specOpsSessionIdCounter = Math.max(specOpsSessionIdCounter, Math.floor(largestNumericSuffix));
  }
}
