import type {
  AgentIndexEntry,
  ChatAgentThreadFileSnapshot,
  ChatMessage,
  ChatMessagePart,
  ChatMessageRole,
  ChatModeId,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
  ChatTokenUsage,
  ToolCallRecord,
  WorkspaceAgentsIndexSnapshot,
} from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import {
  isLegacyChatProviderId,
  normalizeLegacyChatProviderId,
  type LegacyChatProviderId,
} from "../ai/providers/debugProviderSettings";
import { isPersistedChatModeId } from "../ai/modes/chatModesSettings";

export const CHAT_RETENTION_MAX_TURNS = 50;
export const CHAT_THREAD_VERSION = 1;
export const CHAT_AGENTS_INDEX_VERSION = 1;

export function countConversationTurns(messages: readonly ChatMessage[]): number {
  return messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
}

export function needsChatCompaction(
  messages: readonly ChatMessage[],
  maxTurns: number = CHAT_RETENTION_MAX_TURNS,
): boolean {
  return countConversationTurns(messages) > maxTurns;
}

function hashNormalizedPath(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function workspaceChatPathHashKey(normalizedRootPath: string): string {
  return hashNormalizedPath(normalizedRootPath);
}

export function emptyAgentsIndexSnapshot(): WorkspaceAgentsIndexSnapshot {
  return {
    version: CHAT_AGENTS_INDEX_VERSION,
    agents: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChatMessageRole(value: unknown): value is ChatMessageRole {
  return value === "user" || value === "assistant" || value === "system";
}

function isChatModeId(value: unknown): value is ChatModeId {
  return isPersistedChatModeId(value);
}

function normalizeParsedChatModeId(value: unknown): ChatModeId {
  if (isChatModeId(value)) {
    return value;
  }
  return "ask";
}

function normalizeLegacyProviderId(
  provider: LegacyChatProviderId,
  scopeKey: string,
): ChatProviderId {
  return normalizeLegacyChatProviderId(provider, scopeKey);
}

function parseThreadMetadata(value: unknown, scopeKey: string): ChatThreadMetadata | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.agentId !== "string" ||
    typeof value.threadId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  const mode = normalizeParsedChatModeId(value.mode);
  if (!isLegacyChatProviderId(value.provider)) {
    return null;
  }
  if (value.summary !== undefined && typeof value.summary !== "string") {
    return null;
  }
  if (value.compactionCount !== undefined && typeof value.compactionCount !== "number") {
    return null;
  }
  if (value.lastCompactedAt !== undefined && typeof value.lastCompactedAt !== "string") {
    return null;
  }
  if (value.compactedMessageCount !== undefined && typeof value.compactedMessageCount !== "number") {
    return null;
  }
  if (value.selectedModelId !== undefined && typeof value.selectedModelId !== "string") {
    return null;
  }
  if (value.connectionId !== undefined && typeof value.connectionId !== "string") {
    return null;
  }
  if (value.opencodeAgentId !== undefined && typeof value.opencodeAgentId !== "string") {
    return null;
  }
  if (value.opencodeProviderId !== undefined && typeof value.opencodeProviderId !== "string") {
    return null;
  }
  return {
    agentId: value.agentId,
    threadId: value.threadId,
    mode,
    provider: normalizeLegacyProviderId(value.provider, scopeKey),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    summary: value.summary,
    compactionCount: value.compactionCount,
    lastCompactedAt: value.lastCompactedAt,
    compactedMessageCount: value.compactedMessageCount,
    selectedModelId: value.selectedModelId,
    connectionId: value.connectionId,
    opencodeAgentId: value.opencodeAgentId,
    opencodeProviderId: value.opencodeProviderId,
  };
}

function parseProviderSwitchedEvent(
  value: Record<string, unknown>,
  scopeKey: string,
): Extract<ChatMessage["systemEvent"], { type: "provider-switched" }> | undefined {
  const fromProvider = value.fromProvider;
  if (fromProvider !== null && !isLegacyChatProviderId(fromProvider)) {
    return undefined;
  }
  if (!isLegacyChatProviderId(value.toProvider)) {
    return undefined;
  }

  return {
    type: "provider-switched",
    fromProvider:
      fromProvider === null ? null : normalizeLegacyProviderId(fromProvider, scopeKey),
    toProvider: normalizeLegacyProviderId(value.toProvider, scopeKey),
  };
}

function parseModelSwitchedEvent(
  value: Record<string, unknown>,
): Extract<ChatMessage["systemEvent"], { type: "model-switched" }> | undefined {
  const fromModel = value.fromModel;
  if (fromModel !== null && typeof fromModel !== "string") {
    return undefined;
  }
  if (typeof value.toModel !== "string" || value.toModel.length === 0) {
    return undefined;
  }

  return {
    type: "model-switched",
    fromModel,
    toModel: value.toModel,
  };
}

function parseSystemEvent(value: unknown, scopeKey: string): ChatMessage["systemEvent"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.type === "provider-switched") {
    return parseProviderSwitchedEvent(value, scopeKey);
  }
  if (value.type === "model-switched") {
    return parseModelSwitchedEvent(value);
  }
  return undefined;
}

function isToolCallStatus(value: unknown): value is ToolCallRecord["status"] {
  return value === "pending" || value === "success" || value === "failure";
}

function parseToolCallRecord(value: unknown): ToolCallRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.callId !== "string" || typeof value.toolName !== "string" || !isToolCallStatus(value.status)) {
    return null;
  }
  return {
    callId: value.callId,
    toolName: value.toolName,
    status: value.status,
    input: value.input,
    output: value.output,
    progress: value.progress,
  };
}

function parseToolCalls(value: unknown): ToolCallRecord[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const records: ToolCallRecord[] = [];
  for (const entry of value) {
    const record = parseToolCallRecord(entry);
    if (!record) {
      return undefined;
    }
    records.push(record);
  }
  return records;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseTokenUsage(value: unknown): ChatTokenUsage | undefined {
  const parsed = isRecord(value) ? value : null;
  if (!parsed) {
    return undefined;
  }
  if (
    typeof parsed.input !== "number" ||
    typeof parsed.output !== "number" ||
    typeof parsed.reasoning !== "number"
  ) {
    return undefined;
  }
  const cache = isRecord(parsed.cache) ? parsed.cache : null;
  if (!cache || typeof cache.read !== "number" || typeof cache.write !== "number") {
    return undefined;
  }
  return {
    input: parsed.input,
    output: parsed.output,
    reasoning: parsed.reasoning,
    cache: { read: cache.read, write: cache.write },
  };
}

function parseMessagePart(value: unknown): ChatMessagePart | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = parseOptionalString(value.id);
  switch (value.type) {
    case "text": {
      if (typeof value.text !== "string") {
        return null;
      }
      return { type: "text", ...(id !== undefined ? { id } : {}), text: value.text };
    }
    case "reasoning": {
      if (typeof value.text !== "string") {
        return null;
      }
      return { type: "reasoning", ...(id !== undefined ? { id } : {}), text: value.text };
    }
    case "subtask": {
      if (typeof value.agent !== "string") {
        return null;
      }
      const status =
        value.status === "running" || value.status === "completed" || value.status === "failed"
          ? value.status
          : "running";
      return {
        type: "subtask",
        ...(id !== undefined ? { id } : {}),
        agent: value.agent,
        description: parseOptionalString(value.description),
        prompt: parseOptionalString(value.prompt),
        status,
        output: parseOptionalString(value.output),
        error: parseOptionalString(value.error),
      };
    }
    case "step": {
      if (value.phase !== "start" && value.phase !== "finish") {
        return null;
      }
      return {
        type: "step",
        ...(id !== undefined ? { id } : {}),
        phase: value.phase,
        index: parseOptionalNumber(value.index),
        reason: parseOptionalString(value.reason),
        cost: parseOptionalNumber(value.cost),
        tokens: parseTokenUsage(value.tokens),
      };
    }
    case "file": {
      if (typeof value.mime !== "string" || typeof value.url !== "string") {
        return null;
      }
      return {
        type: "file",
        ...(id !== undefined ? { id } : {}),
        mime: value.mime,
        filename: parseOptionalString(value.filename),
        url: value.url,
      };
    }
    case "diff": {
      const files = Array.isArray(value.files)
        ? value.files.filter((entry): entry is string => typeof entry === "string")
        : undefined;
      return {
        type: "diff",
        ...(id !== undefined ? { id } : {}),
        snapshot: parseOptionalString(value.snapshot),
        ...(files !== undefined ? { files } : {}),
      };
    }
    case "compaction": {
      return {
        type: "compaction",
        ...(id !== undefined ? { id } : {}),
        auto: parseOptionalBoolean(value.auto),
      };
    }
    case "cost": {
      if (typeof value.cost !== "number") {
        return null;
      }
      return {
        type: "cost",
        ...(id !== undefined ? { id } : {}),
        cost: value.cost,
        tokens: parseTokenUsage(value.tokens),
      };
    }
    default:
      return null;
  }
}

function parseParts(value: unknown): ChatMessagePart[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: ChatMessagePart[] = [];
  for (const entry of value) {
    const part = parseMessagePart(entry);
    if (!part) {
      return undefined;
    }
    parts.push(part);
  }
  return parts;
}

function parseMessage(value: unknown, scopeKey: string): ChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    !isChatMessageRole(value.role) ||
    typeof value.content !== "string" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    systemEvent: parseSystemEvent(value.systemEvent, scopeKey),
    toolCalls: parseToolCalls(value.toolCalls),
    parts: parseParts(value.parts),
  };
}

function parseThread(value: unknown, scopeKey: string): ChatThreadSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    return null;
  }

  const metadata = parseThreadMetadata(value.metadata, scopeKey);
  if (!metadata) {
    return null;
  }

  const messages: ChatMessage[] = [];
  for (const entry of value.messages) {
    const message = parseMessage(entry, scopeKey);
    if (!message) {
      return null;
    }
    messages.push(message);
  }

  return {
    metadata,
    messages,
  };
}

function parseAgentIndexEntry(value: unknown): AgentIndexEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.lastUsedAt !== "string"
  ) {
    return null;
  }
  if (value.isDraft !== undefined && typeof value.isDraft !== "boolean") {
    return null;
  }
  if (value.opencodeSessionId !== undefined && typeof value.opencodeSessionId !== "string") {
    return null;
  }
  if (value.opencodeModelId !== undefined && typeof value.opencodeModelId !== "string") {
    return null;
  }
  if (value.opencodeProviderId !== undefined && typeof value.opencodeProviderId !== "string") {
    return null;
  }
  if (value.opencodeShareUrl !== undefined && typeof value.opencodeShareUrl !== "string") {
    return null;
  }
  if (
    value.opencodeParentSessionId !== undefined &&
    typeof value.opencodeParentSessionId !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    lastUsedAt: value.lastUsedAt,
    isDraft: value.isDraft,
    opencodeSessionId: value.opencodeSessionId,
    opencodeModelId: value.opencodeModelId,
    opencodeProviderId: value.opencodeProviderId,
    opencodeShareUrl: value.opencodeShareUrl,
    opencodeParentSessionId: value.opencodeParentSessionId,
  };
}

export function decodeChatAgentThreadFileSnapshot(
  raw: string,
  scopeKey: string = CHAT_HTTP_CONTEXT_ID,
): ChatAgentThreadFileSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; thread?: unknown };
    if (parsed.version !== CHAT_THREAD_VERSION) {
      return null;
    }
    const thread = parseThread(parsed.thread, scopeKey);
    if (!thread) {
      return null;
    }
    return {
      version: CHAT_THREAD_VERSION,
      thread,
    };
  } catch {
    return null;
  }
}

export function encodeChatAgentThreadFileSnapshot(snapshot: ChatAgentThreadFileSnapshot): string {
  const normalizedSnapshot: ChatAgentThreadFileSnapshot =
    snapshot.version === CHAT_THREAD_VERSION
      ? snapshot
      : {
          version: CHAT_THREAD_VERSION,
          thread: snapshot.thread,
        };
  return JSON.stringify(normalizedSnapshot, null, 2);
}

export function decodeWorkspaceAgentsIndexSnapshot(raw: string): WorkspaceAgentsIndexSnapshot {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; agents?: unknown };
    if (parsed.version !== CHAT_AGENTS_INDEX_VERSION || !Array.isArray(parsed.agents)) {
      return emptyAgentsIndexSnapshot();
    }

    const agents: AgentIndexEntry[] = [];
    for (const entry of parsed.agents) {
      const agent = parseAgentIndexEntry(entry);
      if (!agent) {
        return emptyAgentsIndexSnapshot();
      }
      agents.push(agent);
    }

    return {
      version: CHAT_AGENTS_INDEX_VERSION,
      agents,
    };
  } catch {
    return emptyAgentsIndexSnapshot();
  }
}

export function encodeWorkspaceAgentsIndexSnapshot(snapshot: WorkspaceAgentsIndexSnapshot): string {
  const normalizedSnapshot: WorkspaceAgentsIndexSnapshot =
    snapshot.version === CHAT_AGENTS_INDEX_VERSION
      ? snapshot
      : {
          version: CHAT_AGENTS_INDEX_VERSION,
          agents: snapshot.agents,
        };
  return JSON.stringify(normalizedSnapshot, null, 2);
}

export function upsertAgentIndexEntry(
  index: WorkspaceAgentsIndexSnapshot,
  entry: AgentIndexEntry,
): WorkspaceAgentsIndexSnapshot {
  const withoutExisting = index.agents.filter((agent) => agent.id !== entry.id);
  return {
    version: CHAT_AGENTS_INDEX_VERSION,
    agents: [...withoutExisting, entry],
  };
}

export function removeAgentIndexEntry(
  index: WorkspaceAgentsIndexSnapshot,
  agentId: string,
): WorkspaceAgentsIndexSnapshot {
  return {
    version: CHAT_AGENTS_INDEX_VERSION,
    agents: index.agents.filter((agent) => agent.id !== agentId),
  };
}
