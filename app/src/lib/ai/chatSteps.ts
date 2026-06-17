import type {
  ChatCostPart,
  ChatMessage,
  ChatMessagePart,
  ChatStepPart,
  ChatTokenUsage,
} from "../domain/contracts";

/**
 * One agentic step boundary extracted from a message's `step` parts.
 *
 * OpenCode emits `step` parts in `start` / `finish` pairs (and a `failed` step
 * surfaces as a finish with no tokens). We collapse each pair into a single
 * boundary so the renderer draws one thin separator per step rather than two.
 */
export interface MessageStepBoundary {
  /** Stable id for keyed rendering; falls back to `${messageId}:step:${index}`. */
  id: string;
  /** 1-based step number for display (`part.index` is 0-based). */
  stepNumber: number;
  /** Running steps emit a start part but no matching finish yet. */
  status: "running" | "completed" | "failed";
  /** Per-step cost (USD) from the finish part, when present. */
  cost?: number;
  /** Per-step token breakdown from the finish part, when present. */
  tokens?: ChatTokenUsage;
  /** Finish reason (e.g. "stop", "length"), when present. */
  reason?: string;
}

/** Cumulative cost / token totals for a message's step boundaries. */
export interface MessageStepTotals {
  cost: number;
  tokens: ChatTokenUsage;
}

/**
 * Cumulative cost / token totals across a whole session (sum of per-message
 * totals). Used for the chat-header / sidebar session running total (M1-T9).
 * `messageCount` is the number of assistant messages that contributed, so the
 * renderer can distinguish "no data yet" from "zero cost".
 */
export interface ChatSessionTotals {
  cost: number;
  tokens: ChatTokenUsage;
  messageCount: number;
}

/**
 * Collapses a message's `step` parts into one boundary per step. Returns an
 * empty array when the message has no parts or no step parts. Steps are
 * ordered by their `index` (the OpenCode-assigned 0-based step counter);
 * missing `index` values fall back to the part's arrival position among step
 * parts so ordering stays stable. A `start` part with no matching `finish`
 * is surfaced as `status: "running"` (a step still in flight); a `finish`
 * part carries the cost / token / reason payload.
 */
export function extractMessageSteps(message: ChatMessage): MessageStepBoundary[] {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return [];
  }

  // Collect step parts in arrival order, recording the position among step
  // parts so we can synthesize an index when OpenCode omits one.
  const stepParts: { part: ChatStepPart; arrival: number }[] = [];
  parts.forEach((part) => {
    if (isStepPart(part)) {
      stepParts.push({ part, arrival: stepParts.length });
    }
  });
  if (stepParts.length === 0) {
    return [];
  }

  // Walk the step parts and pair starts with their following finish. A finish
  // without a preceding open start becomes its own boundary (defensive against
  // out-of-order or replayed streams); an open start with no finish becomes a
  // running boundary.
  type Pending = {
    index: number;
    part: ChatStepPart;
  };
  const boundaries: MessageStepBoundary[] = [];
  const pending = new Map<number, Pending>();

  for (const { part, arrival } of stepParts) {
    const index = resolveStepIndex(part, arrival);
    if (part.phase === "start") {
      // Replace any earlier open start for the same index (re-emitted start).
      pending.set(index, { index, part });
      continue;
    }
    // phase === "finish"
    const open = pending.get(index);
    pending.delete(index);
    const hasTokens = Boolean(part.tokens);
    boundaries.push({
      id: makeBoundaryId(message.id, index, part.id),
      stepNumber: index + 1,
      // A finish with no tokens / negative-looking payload is treated as a
      // failed step (matches the stream `step.failed` mapping which produces
      // no finish part — but a synthetic finish with empty tokens arrives via
      // session.messages hydration for some failed steps).
      status: hasTokens ? "completed" : "failed",
      ...(part.cost !== undefined ? { cost: part.cost } : {}),
      ...(part.tokens ? { tokens: part.tokens } : {}),
      ...(part.reason ? { reason: part.reason } : {}),
    });
  }

  // Any starts still open are steps in flight — append them after completed
  // ones, ordered by index so they render in the right place.
  for (const open of pending.values()) {
    boundaries.push({
      id: makeBoundaryId(message.id, open.index, open.part.id),
      stepNumber: open.index + 1,
      status: "running",
    });
  }

  return boundaries.sort((a, b) => a.stepNumber - b.stepNumber);
}

/**
 * Per-message cost / token totals.
 *
 * OpenCode's `AssistantMessage.info.cost` / `info.tokens` are *cumulative for
 * the whole message* — i.e. the sum of all step-finish parts within it. During
 * session-messages hydration (see `opencodeSessionMessages.ts`) that cumulative
 * value is emitted as a trailing `cost` part. So to avoid double-counting, when
 * a `cost` part is present it IS the canonical message total and the individual
 * step-finish parts are not summed in. When no `cost` part exists (the live
 * streaming case, where totals arrive one step at a time), we sum the
 * step-finish parts instead.
 *
 * Returns `null` when the message has no contributing parts so callers render
 * no footer.
 */
export function extractMessageStepTotals(message: ChatMessage): MessageStepTotals | null {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return null;
  }

  // Prefer the canonical cumulative `cost` part when present.
  const canonical = findCanonicalCostPart(parts);
  if (canonical) {
    return canonical;
  }

  // Otherwise sum across step-finish parts (the live streaming case).
  const aggregated = sumStepFinishes(parts);
  if (aggregated === null) {
    return null;
  }
  return aggregated;
}

/**
 * The last `cost` part on a message is OpenCode's cumulative `info.cost` /
 * `info.tokens` snapshot — the canonical per-message total. Returns it shaped
 * as totals, or `null` when no `cost` part exists. A cost part with neither a
 * finite cost nor a token payload carries nothing and is ignored (caller then
 * falls through to step-finish summing).
 */
function findCanonicalCostPart(parts: ChatMessagePart[]): MessageStepTotals | null {
  let found: ChatCostPart | null = null;
  for (const part of parts) {
    if (isCostPart(part)) {
      found = part;
    }
  }
  if (!found) {
    return null;
  }
  const cost = found.cost !== undefined && Number.isFinite(found.cost) ? found.cost : 0;
  const tokens = found.tokens ?? zeroTokens();
  if (cost === 0 && found.tokens === undefined) {
    return null;
  }
  return { cost, tokens };
}

/**
 * Sums cost / tokens across step-finish parts (the live-streaming case where
 * no canonical `cost` part exists yet). Returns `null` when no step finish
 * contributes. A finish with cost but no tokens still counts as a contributor.
 */
function sumStepFinishes(parts: ChatMessagePart[]): MessageStepTotals | null {
  let cost = 0;
  let contributed = false;
  const tokens: ChatTokenUsage = zeroTokens();

  for (const part of parts) {
    if (!isStepPart(part) || part.phase !== "finish") {
      continue;
    }
    if (part.cost !== undefined && Number.isFinite(part.cost)) {
      cost += part.cost;
    }
    if (part.tokens) {
      tokens.input += part.tokens.input;
      tokens.output += part.tokens.output;
      tokens.reasoning += part.tokens.reasoning;
      tokens.cache.read += part.tokens.cache.read;
      tokens.cache.write += part.tokens.cache.write;
      contributed = true;
    } else {
      // A step finish contributed cost (counted above) even without tokens.
      contributed = true;
    }
  }

  if (!contributed && cost === 0) {
    return null;
  }
  return { cost, tokens };
}

function zeroTokens(): ChatTokenUsage {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
}

/**
 * Sums per-message cost / token totals across a session. Only assistant
 * messages contribute (user/system messages carry no cost). Each message is
 * reduced via `extractMessageStepTotals`, so step-finish / cost-part dedupe is
 * already handled — we never double-count a message's own step finishes against
 * its cumulative `cost` part.
 *
 * Returns `null` when no message contributes (so the header renders no total).
 */
export function extractSessionTotals(messages: readonly ChatMessage[]): ChatSessionTotals | null {
  const tokens = zeroTokens();
  let cost = 0;
  let messageCount = 0;

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    const totals = extractMessageStepTotals(message);
    if (!totals) {
      continue;
    }
    cost += totals.cost;
    tokens.input += totals.tokens.input;
    tokens.output += totals.tokens.output;
    tokens.reasoning += totals.tokens.reasoning;
    tokens.cache.read += totals.tokens.cache.read;
    tokens.cache.write += totals.tokens.cache.write;
    messageCount += 1;
  }

  if (messageCount === 0) {
    return null;
  }
  return { cost, tokens, messageCount };
}

function resolveStepIndex(part: ChatStepPart, arrival: number): number {
  if (typeof part.index === "number" && Number.isFinite(part.index) && part.index >= 0) {
    return part.index;
  }
  return arrival;
}

function makeBoundaryId(messageId: string, index: number, partId: string | undefined): string {
  if (partId && partId.length > 0) {
    return partId;
  }
  return `${messageId}:step:${index}`;
}

function isStepPart(part: { type: unknown }): part is ChatStepPart {
  return part.type === "step";
}

function isCostPart(part: { type: unknown }): part is ChatCostPart {
  return part.type === "cost";
}
