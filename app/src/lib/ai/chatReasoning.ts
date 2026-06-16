import type { ChatMessage, ChatReasoningPart } from "../domain/contracts";

/**
 * Extracted reasoning text shown beneath an assistant message.
 *
 * OpenCode emits one or more `reasoning` parts per assistant message; we join
 * them (in arrival order) into a single block so the UI can render one
 * collapsible panel per message rather than N.
 */
export interface MessageReasoning {
  /** Stable id for keyed rendering; falls back to the message id when no part ids exist. */
  id: string;
  /** Concatenated reasoning text (parts joined by a blank line). */
  text: string;
}

const BLANK_LINE = "\n\n";

/**
 * Returns the reasoning content for a message, or `null` when the message has
 * no reasoning parts (or no parts at all — flat-content messages never carry
 * reasoning). Reasoning parts with empty text after trimming are dropped so an
 * all-whitespace thinking trace doesn't render an empty collapsible.
 */
export function extractMessageReasoning(message: ChatMessage): MessageReasoning | null {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return null;
  }

  // Pair each reasoning part with its trimmed text so we can drop whitespace-only
  // entries before deriving both the joined text and the stable id.
  const surviving = parts
    .filter(isReasoningPart)
    .map((part) => ({ id: part.id, text: part.text.trim() }))
    .filter((entry) => entry.text.length > 0);
  if (surviving.length === 0) {
    return null;
  }

  const id = surviving
    .map((entry) => entry.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("|");

  return {
    id: id.length > 0 ? id : message.id,
    text: surviving.map((entry) => entry.text).join(BLANK_LINE),
  };
}

function isReasoningPart(part: { type: unknown }): part is ChatReasoningPart {
  return part.type === "reasoning";
}
