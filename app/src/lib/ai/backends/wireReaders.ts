import type { ChatTokenUsage } from "../../domain/contracts";

/**
 * Shared tolerant wire readers for OpenCode payloads (M9).
 *
 * These were previously triplicated across `opencodeSessionMessages`,
 * `workspaceAgentBackend`, and the chat-persistence codec. Extracting them
 * into one place prevents drift as the OpenCode wire shapes evolve.
 *
 * Contract notes (load-bearing — do not change without auditing call sites):
 *  - `readString` returns `null` for whitespace-only strings. Callers rely on
 *    this to gate *required* fields (e.g. message id). Use `readOptionalString`
 *    when an empty/whitespace value should map to "absent" rather than "invalid".
 *  - `readNumber` returns `null` for non-finite numbers (`NaN` / `±Infinity`).
 *  - All readers return `null` (not `undefined`) on invalid input so callers can
 *    distinguish "absent" from "present-but-invalid" with a single null check.
 */

export function readObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Like {@link readString} but maps an absent/invalid/whitespace value to
 * `undefined` instead of `null` — the "optional field" companion used by mappers
 * that only want to set a property when it carries real content.
 */
export function readOptionalString(value: unknown): string | undefined {
  const parsed = readString(value);
  return parsed === null ? undefined : parsed;
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Reads an array of strings, dropping any non-string entries. Returns `null`
 * when the value is not an array; returns an empty array for an array with no
 * string entries (callers decide whether an empty list is meaningful).
 */
export function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      result.push(entry);
    }
  }
  return result;
}

/**
 * Reads a `{ input, output, reasoning, cache: { read, write } }` token-usage
 * payload. Returns `null` when the shape is missing fields or carries
 * non-finite numbers. `ChatTokenUsage` and `WorkspaceAgentTokenUsage` are
 * structurally identical, so this reader serves both sites.
 */
export function readTokenUsage(value: unknown): ChatTokenUsage | null {
  const parsed = readObject(value);
  if (!parsed) {
    return null;
  }
  const input = readNumber(parsed.input);
  const output = readNumber(parsed.output);
  const reasoning = readNumber(parsed.reasoning);
  if (input === null || output === null || reasoning === null) {
    return null;
  }
  const cache = readObject(parsed.cache);
  const cacheRead = cache ? readNumber(cache.read) : null;
  const cacheWrite = cache ? readNumber(cache.write) : null;
  if (cacheRead === null || cacheWrite === null) {
    return null;
  }
  return {
    input,
    output,
    reasoning,
    cache: { read: cacheRead, write: cacheWrite },
  };
}
