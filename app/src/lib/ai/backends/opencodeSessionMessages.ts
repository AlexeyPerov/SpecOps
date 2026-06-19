import type {
  ChatMessage,
  ChatMessagePart,
  ChatMessageRole,
  ChatSubtaskStatus,
  ToolCallRecord,
  ToolCallStatus,
} from "../../domain/contracts";
import type { OpencodeSessionMessageEntry } from "./workspaceAgentBackend";
import {
  readNumber,
  readObject,
  readOptionalString,
  readString,
  readStringList,
  readTokenUsage,
} from "./wireReaders";

/**
 * Maps OpenCode `session.messages` entries (`{ info, parts }`) to SpecOps
 * `ChatMessage[]` carrying full structured parts (M1-T3 hydration source of
 * truth; local thread snapshot becomes offline cache/fallback per Q3 decision).
 *
 * The mapper is deliberately lenient: malformed entries/parts are dropped
 * rather than failing the whole hydration (matches codec behaviour).
 */

function mapReasoningPart(raw: Record<string, unknown>): ChatMessagePart | null {
  const text = typeof raw.text === "string" ? raw.text : null;
  if (text === null) {
    return null;
  }
  return {
    type: "reasoning",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    text,
  };
}

function mapTextPart(raw: Record<string, unknown>): ChatMessagePart | null {
  if (typeof raw.text !== "string") {
    return null;
  }
  return {
    type: "text",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    text: raw.text,
  };
}

function mapSubtaskPart(raw: Record<string, unknown>): ChatMessagePart | null {
  const agent = readString(raw.agent);
  if (!agent) {
    return null;
  }
  const statusValue = readString(raw.status);
  const status: ChatSubtaskStatus =
    statusValue === "completed" || statusValue === "failed" ? statusValue : "running";
  return {
    type: "subtask",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    agent,
    description: readOptionalString(raw.description),
    prompt: readOptionalString(raw.prompt),
    status,
    output: readOptionalString(raw.output),
    error: readOptionalString(raw.error),
  };
}

function mapStepStartPart(raw: Record<string, unknown>, index: number): ChatMessagePart | null {
  return {
    type: "step",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    phase: "start",
    index,
  };
}

function mapStepFinishPart(raw: Record<string, unknown>, index: number): ChatMessagePart | null {
  const tokens = readTokenUsage(raw.tokens);
  return {
    type: "step",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    phase: "finish",
    index,
    reason: readOptionalString(raw.reason),
    cost: readNumber(raw.cost) ?? undefined,
    ...(tokens ? { tokens } : {}),
  };
}

function mapFilePart(raw: Record<string, unknown>): ChatMessagePart | null {
  if (typeof raw.mime !== "string" || typeof raw.url !== "string") {
    return null;
  }
  return {
    type: "file",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    mime: raw.mime,
    filename: readOptionalString(raw.filename),
    url: raw.url,
  };
}

function mapSnapshotPart(raw: Record<string, unknown>): ChatMessagePart | null {
  const snapshot = readString(raw.snapshot);
  if (!snapshot) {
    return null;
  }
  return {
    type: "diff",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    snapshot,
  };
}

function mapPatchPart(raw: Record<string, unknown>): ChatMessagePart | null {
  const files = readStringList(raw.files);
  if (!files || files.length === 0) {
    return null;
  }
  return {
    type: "diff",
    ...(readOptionalString(raw.id) ? { id: readOptionalString(raw.id) } : {}),
    ...(readOptionalString(raw.hash) ? { snapshot: readOptionalString(raw.hash) } : {}),
    files,
  };
}

/**
 * Map a single OpenCode part to a SpecOps part. Returns null when the part
 * type is unsupported (tool, agent, retry, compaction) or malformed — callers
 * drop them.
 *
 * `compaction` is intentionally not mapped: SpecOps renders its own FIFO
 * compaction banner (see `chatRetention.ts` / `ChatMessageList`'s
 * `compactionNotice` prop), which is a different concept from OpenCode's
 * per-message compaction marker, so the part type carries no UI consumer and
 * is dropped here. See `specs/changelog.md` (M11-T2).
 */
function mapSessionPart(
  raw: unknown,
  stepIndex: number,
): ChatMessagePart | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  switch (parsed.type) {
    case "text":
      return mapTextPart(parsed);
    case "reasoning":
      return mapReasoningPart(parsed);
    case "subtask":
      return mapSubtaskPart(parsed);
    case "step-start":
      return mapStepStartPart(parsed, stepIndex);
    case "step-finish":
      return mapStepFinishPart(parsed, stepIndex);
    case "file":
      return mapFilePart(parsed);
    case "snapshot":
      return mapSnapshotPart(parsed);
    case "patch":
      return mapPatchPart(parsed);
    case "compaction":
      // No UI consumer — dropped (see function docstring).
      return null;
    default:
      // tool / agent / retry — handled elsewhere or out of scope.
      return null;
  }
}

function mapToolStateToStatus(raw: unknown): ToolCallStatus {
  const parsed = readObject(raw);
  if (!parsed) {
    return "pending";
  }
  if (parsed.status === "completed") {
    return "success";
  }
  if (parsed.status === "error") {
    return "failure";
  }
  return "pending";
}

function extractToolCallFromPart(raw: unknown): ToolCallRecord | null {
  const parsed = readObject(raw);
  if (!parsed || parsed.type !== "tool") {
    return null;
  }
  const callId = readString(parsed.callID) ?? readString(parsed.callId);
  const toolName = readString(parsed.tool) ?? readString(parsed.toolName);
  if (!callId || !toolName) {
    return null;
  }
  const state = readObject(parsed.state) ?? {};
  const status = mapToolStateToStatus(parsed.state);
  const input = state.input ?? undefined;
  const output =
    typeof state.output === "string" ? state.output : state.result ?? undefined;
  return {
    callId,
    toolName,
    status,
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
  };
}

function mapToolCalls(parts: unknown[]): ToolCallRecord[] | undefined {
  const records: ToolCallRecord[] = [];
  for (const part of parts) {
    const record = extractToolCallFromPart(part);
    if (record) {
      records.push(record);
    }
  }
  return records.length > 0 ? records : undefined;
}

function resolveMessageRole(info: Record<string, unknown>): ChatMessageRole | null {
  if (info.role === "user") {
    return "user";
  }
  if (info.role === "assistant") {
    return "assistant";
  }
  // OpenCode emits synthetic/system messages with non-user/assistant roles;
  // surface them as system markers so they don't pollute turn accounting.
  if (typeof info.role === "string" && info.role.length > 0) {
    return "system";
  }
  return null;
}

function resolveCreatedAt(info: Record<string, unknown>): string | null {
  const time = readObject(info.time);
  if (time) {
    const created = readNumber(time.created);
    if (created !== null) {
      return new Date(created).toISOString();
    }
    const createdString = readString(time.created);
    if (createdString) {
      return createdString;
    }
  }
  // Fallbacks observed across SDK versions.
  return readString(info.createdAt) ?? readString(info.created_at);
}

/**
 * Flatten text parts into a single content string used as the plain-text
 * fallback / summary (matches the dual-content contract from M1-T1).
 */
function flattenTextContent(parts: ChatMessagePart[]): string {
  return parts
    .filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function mapPartsAndIndex(parts: unknown[]): {
  parts: ChatMessagePart[];
  stepIndex: number;
} {
  const result: ChatMessagePart[] = [];
  let stepIndex = 0;
  for (const raw of parts) {
    const mapped = mapSessionPart(raw, stepIndex);
    if (!mapped) {
      continue;
    }
    if (mapped.type === "step" && mapped.phase === "finish") {
      stepIndex += 1;
    }
    result.push(mapped);
  }
  return { parts: result, stepIndex };
}

export function mapSessionMessageEntry(entry: unknown): ChatMessage | null {
  const parsed = readObject(entry);
  if (!parsed) {
    return null;
  }
  const info = readObject(parsed.info);
  if (!info) {
    return null;
  }
  const role = resolveMessageRole(info);
  if (!role) {
    return null;
  }
  const id = readString(info.id);
  if (!id) {
    return null;
  }
  const createdAt = resolveCreatedAt(info);
  if (!createdAt) {
    return null;
  }
  const rawParts = Array.isArray(parsed.parts) ? parsed.parts : [];
  const { parts: structuredParts } = mapPartsAndIndex(rawParts);

  // Preserve text content from local snapshot for user/system messages (no
  // parts arrive for these in OpenCode history beyond user prompts). For
  // assistant messages prefer flattened text parts; fall back to summary.
  let content = "";
  if (role === "assistant") {
    content = flattenTextContent(structuredParts);
    if (content.length === 0) {
      const summary = readObject(info.summary);
      const summaryBody = summary ? readString(summary.body) : null;
      content = summaryBody ?? "";
    }
  } else {
    // user + system (e.g. synthetic context-injection markers).
    content = flattenTextContent(structuredParts);
  }

  const toolCalls = mapToolCalls(rawParts);
  const parts = structuredParts.length > 0 ? structuredParts : undefined;

  const message: ChatMessage = {
    id,
    role,
    content,
    createdAt,
    ...(toolCalls ? { toolCalls } : {}),
    ...(parts ? { parts } : {}),
  };

  // Assistant messages carry cumulative cost / token totals on `info`. Emit a
  // trailing `cost` part so renderers (M1-T9) can show per-message totals even
  // when no step-finish part is present.
  if (role === "assistant") {
    const tokens = readTokenUsage(info.tokens);
    const cost = readNumber(info.cost);
    if (tokens && cost !== null) {
      const costPart: ChatMessagePart = {
        type: "cost",
        cost,
        ...(tokens ? { tokens } : {}),
      };
      message.parts = [...(message.parts ?? []), costPart];
    }
  }
  return message;
}

export function mapSessionMessages(entries: readonly unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const entry of entries) {
    const message = mapSessionMessageEntry(entry);
    if (message) {
      messages.push(message);
    }
  }
  return messages;
}

export function mapSessionMessageEntries(
  entries: readonly OpencodeSessionMessageEntry[],
): ChatMessage[] {
  return mapSessionMessages(entries as readonly unknown[]);
}
