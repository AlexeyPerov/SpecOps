import type { ChatDiffPart, ChatMessage } from "../domain/contracts";

/**
 * Extracted diff / snapshot part shown beneath an assistant message.
 *
 * OpenCode emits `snapshot` parts (a checkpoint of the workspace state, keyed
 * by a hash) and `patch` parts (the set of files changed since the last
 * snapshot). Both are normalized into a single SpecOps `ChatDiffPart` during
 * session-messages hydration (see `opencodeSessionMessages.ts`):
 *   - `snapshot` → `{ type: "diff", snapshot }` (the checkpoint hash)
 *   - `patch`    → `{ type: "diff", snapshot?, files }` (hash + changed files)
 *
 * IMPORTANT — what is on the wire vs. what is not:
 * Neither part carries the unified-diff *content* (the `+`/`-` hunks). The full
 * line-level diff lives behind the separate `session.diff` API (M5-T2). So the
 * inline preview (M1-T8) renders the metadata we do have — the checkpoint hash
 * and the list of changed file paths — rather than a per-line diff viewer.
 *
 * A `diff` part with neither a `snapshot` hash nor any changed files carries no
 * renderable information, so it is dropped.
 */
export interface MessageDiff {
  /** Stable id for keyed rendering; falls back to `${messageId}:diff:${index}`. */
  id: string;
  /** Checkpoint hash (from OpenCode `snapshot` / `patch.hash`), when present. */
  snapshot?: string;
  /** Changed file paths (from OpenCode `patch.files`), when present. */
  files?: string[];
}

function isDiffPart(part: { type: unknown }): part is ChatDiffPart {
  return part.type === "diff";
}

/**
 * Returns the diff parts for a message, in arrival order. Returns an empty
 * array when the message has no parts or no diff parts. Drops parts that carry
 * neither a snapshot hash nor any file paths (nothing to render). File paths
 * are trimmed; whitespace-only entries are dropped. Like the other extractors
 * the helper is role-agnostic — only assistant messages carry agentic
 * snapshot/patch parts, but role filtering stays the component's concern
 * (mirrors reasoning/subtask/step).
 */
export function extractMessageDiffs(message: ChatMessage): MessageDiff[] {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return [];
  }

  const diffs: MessageDiff[] = [];
  parts.forEach((part, index) => {
    if (!isDiffPart(part)) {
      return;
    }
    const snapshot = part.snapshot?.trim();
    const files = part.files
      ?.map((file) => file.trim())
      .filter((file) => file.length > 0);
    if ((!snapshot || snapshot.length === 0) && (!files || files.length === 0)) {
      return;
    }
    diffs.push({
      id: part.id && part.id.length > 0 ? part.id : `${message.id}:diff:${index}`,
      ...(snapshot && snapshot.length > 0 ? { snapshot } : {}),
      ...(files && files.length > 0 ? { files } : {}),
    });
  });
  return diffs;
}

/**
 * Convenience: total diff-part count for a message. Returns 0 when the message
 * carries no renderable diff parts (dropped parts don't count). Useful for the
 * renderer to skip the diff region entirely.
 */
export function countMessageDiffs(message: ChatMessage): number {
  return extractMessageDiffs(message).length;
}
