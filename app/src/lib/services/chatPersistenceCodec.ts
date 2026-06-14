import type {
  AgentIndexEntry,
  ChatAgentThreadFileSnapshot,
  ChatMessage,
  ChatMessageRole,
  ChatModeId,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
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
  return {
    id: value.id,
    title: value.title,
    lastUsedAt: value.lastUsedAt,
    isDraft: value.isDraft,
    opencodeSessionId: value.opencodeSessionId,
    opencodeModelId: value.opencodeModelId,
    opencodeProviderId: value.opencodeProviderId,
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
