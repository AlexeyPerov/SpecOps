/**
 * Golden protocol fixtures (phase D, task AS01-D-04).
 *
 * Categorize wire lines as valid / malformed / oversized / unknown / timed-out
 * so the framing and process suites assert deterministic behavior on each
 * boundary. Oversized lines are built from the {@link MAX_MESSAGE_BYTES} limit
 * (not embedded as megabyte literals).
 */

import { MAX_MESSAGE_BYTES } from "./protocol";

export type FixtureCategory = "valid" | "malformed" | "oversized" | "unknown" | "timed-out";

export interface ProtocolFixture {
  readonly name: string;
  readonly category: FixtureCategory;
  readonly line: string;
  readonly description: string;
}

/** A well-formed initialize request that the host must accept. */
export const VALID_INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: 1, client: { name: "fixture" } },
});

export const PROTOCOL_FIXTURES: readonly ProtocolFixture[] = [
  {
    name: "valid-initialize",
    category: "valid",
    line: VALID_INITIALIZE,
    description: "A well-formed initialize request.",
  },
  {
    name: "valid-notification-shape",
    category: "valid",
    line: JSON.stringify({ jsonrpc: "2.0", method: "noop", params: {} }),
    description: "A well-formed notification envelope (host ignores unknown notifications).",
  },
  {
    name: "malformed-broken-json",
    category: "malformed",
    line: "{not json",
    description: "Broken JSON that fails to parse.",
  },
  {
    name: "malformed-empty-object",
    category: "malformed",
    line: "{}",
    description: "Valid JSON but not a JSON-RPC 2.0 message.",
  },
  {
    name: "malformed-unquoted-key",
    category: "malformed",
    line: "{id:1,method:\"x\"}",
    description: "Unquoted object key is not valid JSON.",
  },
  {
    name: "unknown-method",
    category: "unknown",
    line: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "does.not.exist", params: {} }),
    description: "Well-formed request with an unrecognized method.",
  },
];

/** Build an oversized line that exceeds the framing limit by `extraBytes`. */
export function buildOversizedLine(extraBytes = 16): string {
  const base = {
    jsonrpc: "2.0",
    id: 99,
    method: "initialize",
    params: { pad: "x".repeat(MAX_MESSAGE_BYTES + extraBytes) },
  };
  return JSON.stringify(base);
}

/**
 * "timed-out" is a behavioral category, not a single line: a long turn whose
 * cancellation models a client-side timeout. The process suite drives it as a
 * sequence (turn.send followed by turn.cancel) and asserts turn.cancelled.
 */
export const TIMED_OUT_DESCRIPTION =
  "A long-running turn cancelled mid-stream models a client-side timeout; the host must forward turn.cancelled.";
