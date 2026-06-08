import { readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ChatAgentThreadFileSnapshot,
  ChatThreadSnapshot,
  WorkspaceAgentsIndexSnapshot,
} from "../domain/contracts";
import type { ChatScopeKey } from "../state/chatStore/types";
import { normalizeThreadSnapshotForScope } from "../ai/providers/threadScopeNormalization";
import { deriveAgentTitleFromThread } from "./chatAgents";
import {
  CHAT_THREAD_VERSION,
  countConversationTurns,
  decodeChatAgentThreadFileSnapshot,
  decodeWorkspaceAgentsIndexSnapshot,
  encodeChatAgentThreadFileSnapshot,
  encodeWorkspaceAgentsIndexSnapshot,
  needsChatCompaction,
  removeAgentIndexEntry,
  upsertAgentIndexEntry,
  CHAT_RETENTION_MAX_TURNS,
  emptyAgentsIndexSnapshot,
  workspaceChatPathHashKey,
} from "./chatPersistenceCodec";
import {
  chatScopeStorageSegment,
  getAgentThreadFilePath,
  getWorkspaceAgentsDir,
  getWorkspaceAgentsIndexFilePath,
} from "./chatPersistencePaths";

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

export {
  chatScopeStorageSegment,
  CHAT_RETENTION_MAX_TURNS,
  countConversationTurns,
  decodeChatAgentThreadFileSnapshot,
  decodeWorkspaceAgentsIndexSnapshot,
  encodeChatAgentThreadFileSnapshot,
  encodeWorkspaceAgentsIndexSnapshot,
  getAgentThreadFilePath,
  getWorkspaceAgentsDir,
  getWorkspaceAgentsIndexFilePath,
  needsChatCompaction,
  removeAgentIndexEntry,
  upsertAgentIndexEntry,
  workspaceChatPathHashKey,
};
