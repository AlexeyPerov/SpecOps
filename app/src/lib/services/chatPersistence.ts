import { join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  AgentIndexEntry,
  ChatAgentThreadFileSnapshot,
  ChatMessage,
  ChatMessageRole,
  ChatModeId,
  ChatProviderId,
  ChatThreadMetadata,
  ChatThreadSnapshot,
  WorkspaceAgentsIndexSnapshot,
} from "../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID } from "../domain/contracts";
import type { ChatScopeKey } from "../state/chatStore/types";
import {
  isLegacyChatProviderId,
  normalizeLegacyChatProviderId,
  type LegacyChatProviderId,
} from "../ai/providers/debugProviderSettings";
import { normalizeThreadSnapshotForScope } from "../ai/providers/threadScopeNormalization";
import { deriveAgentTitleFromThread } from "./chatAgents";
import { ensureSpecOpsDataDir } from "./appDataDir";

/**
 * Rolling retention cap per agent thread.
 *
 * Policy (specs/ai-requirements.md — Persistence and retention):
 * - One thread per agent with a rolling turn cap.
 * - On overflow, remove oldest turns first (FIFO); never drop newest messages.
 * - Removed turn text is summarized into `thread.metadata.summary` (M4-3).
 *
 * A turn starts at each user message and includes following assistant replies
 * until the next user message. Compaction runs on append/save, not on load.
 */
export const CHAT_RETENTION_MAX_TURNS = 50;

export function countConversationTurns(messages: readonly ChatMessage[]): number {
  return messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);
}

export function needsChatCompaction(
  messages: readonly ChatMessage[],
  maxTurns: number = CHAT_RETENTION_MAX_TURNS,
): boolean {
  return countConversationTurns(messages) > maxTurns;
}

const CHAT_THREAD_VERSION = 1;
const CHAT_AGENTS_INDEX_VERSION = 1;
const CHAT_DIR_NAME = "chat";
const AGENTS_INDEX_FILE = "index.json";
const PERSIST_DEBOUNCE_MS = 700;

type PendingAgentPersist = {
  scopeKey: ChatScopeKey;
  agentId: string;
  snapshot: ChatAgentThreadFileSnapshot;
};

type PendingIndexPersist = {
  scopeKey: ChatScopeKey;
  snapshot: WorkspaceAgentsIndexSnapshot;
};

let agentPersistTimer: ReturnType<typeof setTimeout> | null = null;
let indexPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingAgentPersist: PendingAgentPersist | null = null;
let pendingIndexPersist: PendingIndexPersist | null = null;

/** Clears debounce timer state between unit tests. */
export function resetChatPersistenceForTests(): void {
  if (agentPersistTimer) {
    clearTimeout(agentPersistTimer);
    agentPersistTimer = null;
  }
  if (indexPersistTimer) {
    clearTimeout(indexPersistTimer);
    indexPersistTimer = null;
  }
  pendingAgentPersist = null;
  pendingIndexPersist = null;
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

/** Resolves the on-disk segment under `chat/` for a chat scope key. */
export function chatScopeStorageSegment(scopeKey: ChatScopeKey): string {
  if (scopeKey === CHAT_HTTP_CONTEXT_ID) {
    return CHAT_HTTP_CONTEXT_ID;
  }
  return workspaceChatPathHashKey(scopeKey);
}

function emptyAgentsIndexSnapshot(): WorkspaceAgentsIndexSnapshot {
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
  return value === "ask" || value === "review";
}

function isChatProviderId(value: unknown): value is ChatProviderId {
  return (
    value === "http" ||
    value === "debug-chat" ||
    value === "debug-workspace"
  );
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
    !isChatModeId(value.mode) ||
    !isLegacyChatProviderId(value.provider) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
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
  return {
    agentId: value.agentId,
    threadId: value.threadId,
    mode: value.mode,
    provider: normalizeLegacyProviderId(value.provider, scopeKey),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    summary: value.summary,
    compactionCount: value.compactionCount,
    lastCompactedAt: value.lastCompactedAt,
    compactedMessageCount: value.compactedMessageCount,
    selectedModelId: value.selectedModelId,
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
  return {
    id: value.id,
    title: value.title,
    lastUsedAt: value.lastUsedAt,
    isDraft: value.isDraft,
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

export async function getWorkspaceAgentsDir(scopeKey: ChatScopeKey): Promise<string> {
  const base = await ensureSpecOpsDataDir();
  const chatDir = await join(base, CHAT_DIR_NAME);
  const workspaceDir = await join(chatDir, chatScopeStorageSegment(scopeKey));
  await mkdir(workspaceDir, { recursive: true });
  return workspaceDir;
}

export async function getWorkspaceAgentsIndexFilePath(scopeKey: ChatScopeKey): Promise<string> {
  const workspaceDir = await getWorkspaceAgentsDir(scopeKey);
  return join(workspaceDir, AGENTS_INDEX_FILE);
}

export async function getAgentThreadFilePath(
  scopeKey: ChatScopeKey,
  agentId: string,
): Promise<string> {
  const workspaceDir = await getWorkspaceAgentsDir(scopeKey);
  return join(workspaceDir, `${agentId}.json`);
}

export async function readWorkspaceAgentsIndexSnapshot(
  scopeKey: ChatScopeKey,
): Promise<WorkspaceAgentsIndexSnapshot> {
  try {
    const indexPath = await getWorkspaceAgentsIndexFilePath(scopeKey);
    const raw = await readTextFile(indexPath);
    return decodeWorkspaceAgentsIndexSnapshot(raw);
  } catch {
    return emptyAgentsIndexSnapshot();
  }
}

export async function writeWorkspaceAgentsIndexSnapshot(
  scopeKey: ChatScopeKey,
  snapshot: WorkspaceAgentsIndexSnapshot,
): Promise<void> {
  const indexPath = await getWorkspaceAgentsIndexFilePath(scopeKey);
  await writeTextFile(indexPath, encodeWorkspaceAgentsIndexSnapshot(snapshot));
}

export async function readAgentThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  agentId: string,
): Promise<ChatThreadSnapshot | null> {
  try {
    const threadPath = await getAgentThreadFilePath(scopeKey, agentId);
    const raw = await readTextFile(threadPath);
    const decoded = decodeChatAgentThreadFileSnapshot(raw, scopeKey);
    return normalizeThreadSnapshotForScope(decoded?.thread ?? null, scopeKey);
  } catch {
    return null;
  }
}

export async function writeAgentThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  agentId: string,
  snapshot: ChatAgentThreadFileSnapshot,
): Promise<void> {
  const threadPath = await getAgentThreadFilePath(scopeKey, agentId);
  await writeTextFile(threadPath, encodeChatAgentThreadFileSnapshot(snapshot));
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

export async function syncAgentIndexEntryForThread(
  scopeKey: ChatScopeKey,
  agentId: string,
  thread: ChatThreadSnapshot,
): Promise<WorkspaceAgentsIndexSnapshot> {
  const currentIndex = await readWorkspaceAgentsIndexSnapshot(scopeKey);
  const nextIndex = upsertAgentIndexEntry(currentIndex, {
    id: agentId,
    title: deriveAgentTitleFromThread(thread),
    lastUsedAt: thread.metadata.updatedAt,
  });
  await writeWorkspaceAgentsIndexSnapshot(scopeKey, nextIndex);
  return nextIndex;
}

export async function persistAgentThreadSnapshot(
  scopeKey: ChatScopeKey,
  agentId: string,
  thread: ChatThreadSnapshot,
): Promise<void> {
  await syncAgentIndexEntryForThread(scopeKey, agentId, thread);
  await writeAgentThreadFileSnapshot(scopeKey, agentId, {
    version: CHAT_THREAD_VERSION,
    thread,
  });
}

export async function deleteAgentThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  agentId: string,
): Promise<void> {
  if (pendingAgentPersist?.scopeKey === scopeKey && pendingAgentPersist.agentId === agentId) {
    pendingAgentPersist = null;
  }

  try {
    const threadPath = await getAgentThreadFilePath(scopeKey, agentId);
    await remove(threadPath);
  } catch {
    // missing thread file is fine for drafts and already-deleted agents
  }
}

export async function deleteAgentPersistence(
  scopeKey: ChatScopeKey,
  agentId: string,
): Promise<void> {
  await deleteAgentThreadFileSnapshot(scopeKey, agentId);
  const currentIndex = await readWorkspaceAgentsIndexSnapshot(scopeKey);
  const nextIndex = removeAgentIndexEntry(currentIndex, agentId);
  await writeWorkspaceAgentsIndexSnapshot(scopeKey, nextIndex);
}

export function scheduleAgentThreadFilePersistence(
  scopeKey: ChatScopeKey,
  agentId: string,
  snapshot: ChatAgentThreadFileSnapshot,
): void {
  pendingAgentPersist = { scopeKey, agentId, snapshot };
  if (agentPersistTimer) {
    clearTimeout(agentPersistTimer);
  }
  agentPersistTimer = setTimeout(() => {
    const next = pendingAgentPersist;
    pendingAgentPersist = null;
    agentPersistTimer = null;
    if (!next) {
      return;
    }
    void persistAgentThreadSnapshot(next.scopeKey, next.agentId, next.snapshot.thread);
  }, PERSIST_DEBOUNCE_MS);
}

export function scheduleWorkspaceAgentsIndexPersistence(
  scopeKey: ChatScopeKey,
  snapshot: WorkspaceAgentsIndexSnapshot,
): void {
  pendingIndexPersist = { scopeKey, snapshot };
  if (indexPersistTimer) {
    clearTimeout(indexPersistTimer);
  }
  indexPersistTimer = setTimeout(() => {
    const next = pendingIndexPersist;
    pendingIndexPersist = null;
    indexPersistTimer = null;
    if (!next) {
      return;
    }
    void writeWorkspaceAgentsIndexSnapshot(next.scopeKey, next.snapshot);
  }, PERSIST_DEBOUNCE_MS);
}
