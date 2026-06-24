import { readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ChatSessionThreadFileSnapshot,
  ChatThreadSnapshot,
  WorkspaceSessionsIndexSnapshot,
} from "../domain/contracts";
import type { ChatScopeKey } from "../state/chatStore/types";
import { normalizeThreadSnapshotForScope } from "../ai/providers/threadScopeNormalization";
import { deriveSessionTitleFromThread } from "./chatSessions";
import {
  CHAT_THREAD_VERSION,
  countConversationTurns,
  decodeChatSessionThreadFileSnapshot,
  decodeWorkspaceSessionsIndexSnapshot,
  encodeChatSessionThreadFileSnapshot,
  encodeWorkspaceSessionsIndexSnapshot,
  needsChatCompaction,
  removeSessionIndexEntry,
  upsertSessionIndexEntry,
  CHAT_RETENTION_MAX_TURNS,
  emptySessionsIndexSnapshot,
  workspaceChatPathHashKey,
} from "./chatPersistenceCodec";
import {
  chatScopeStorageSegment,
  getSessionThreadFilePath,
  getWorkspaceSessionsDir,
  getWorkspaceSessionsIndexFilePath,
} from "./chatPersistencePaths";

/**
 * Rolling retention cap per session thread.
 *
 * Policy (specs/ai-requirements.md — Persistence and retention):
 * - One thread per session with a rolling turn cap.
 * - On overflow, remove oldest turns first (FIFO); never drop newest messages.
 * - Removed turn text is summarized into `thread.metadata.summary` (M4-3).
 *
 * A turn starts at each user message and includes following assistant replies
 * until the next user message. Compaction runs on append/save, not on load.
 */
const PERSIST_DEBOUNCE_MS = 700;

type PendingSessionPersist = {
  scopeKey: ChatScopeKey;
  sessionId: string;
  snapshot: ChatSessionThreadFileSnapshot;
};

type PendingIndexPersist = {
  scopeKey: ChatScopeKey;
  snapshot: WorkspaceSessionsIndexSnapshot;
};

let sessionPersistTimer: ReturnType<typeof setTimeout> | null = null;
let indexPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSessionPersist: PendingSessionPersist | null = null;
let pendingIndexPersist: PendingIndexPersist | null = null;

/** Clears debounce timer state between unit tests. */
export function resetChatPersistenceForTests(): void {
  if (sessionPersistTimer) {
    clearTimeout(sessionPersistTimer);
    sessionPersistTimer = null;
  }
  if (indexPersistTimer) {
    clearTimeout(indexPersistTimer);
    indexPersistTimer = null;
  }
  pendingSessionPersist = null;
  pendingIndexPersist = null;
}

export async function readWorkspaceSessionsIndexSnapshot(
  scopeKey: ChatScopeKey,
): Promise<WorkspaceSessionsIndexSnapshot> {
  try {
    const indexPath = await getWorkspaceSessionsIndexFilePath(scopeKey);
    const raw = await readTextFile(indexPath);
    return decodeWorkspaceSessionsIndexSnapshot(raw);
  } catch {
    return emptySessionsIndexSnapshot();
  }
}

export async function writeWorkspaceSessionsIndexSnapshot(
  scopeKey: ChatScopeKey,
  snapshot: WorkspaceSessionsIndexSnapshot,
): Promise<void> {
  const indexPath = await getWorkspaceSessionsIndexFilePath(scopeKey);
  await writeTextFile(indexPath, encodeWorkspaceSessionsIndexSnapshot(snapshot));
}

export async function readSessionThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  sessionId: string,
): Promise<ChatThreadSnapshot | null> {
  try {
    const threadPath = await getSessionThreadFilePath(scopeKey, sessionId);
    const raw = await readTextFile(threadPath);
    const decoded = decodeChatSessionThreadFileSnapshot(raw, scopeKey);
    return normalizeThreadSnapshotForScope(decoded?.thread ?? null, scopeKey);
  } catch {
    return null;
  }
}

export async function writeSessionThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  sessionId: string,
  snapshot: ChatSessionThreadFileSnapshot,
): Promise<void> {
  const threadPath = await getSessionThreadFilePath(scopeKey, sessionId);
  await writeTextFile(threadPath, encodeChatSessionThreadFileSnapshot(snapshot));
}

export async function syncSessionIndexEntryForThread(
  scopeKey: ChatScopeKey,
  sessionId: string,
  thread: ChatThreadSnapshot,
): Promise<WorkspaceSessionsIndexSnapshot> {
  const currentIndex = await readWorkspaceSessionsIndexSnapshot(scopeKey);
  const nextIndex = upsertSessionIndexEntry(currentIndex, {
    id: sessionId,
    title: deriveSessionTitleFromThread(thread),
    lastUsedAt: thread.metadata.updatedAt,
  });
  await writeWorkspaceSessionsIndexSnapshot(scopeKey, nextIndex);
  return nextIndex;
}

export async function persistSessionThreadSnapshot(
  scopeKey: ChatScopeKey,
  sessionId: string,
  thread: ChatThreadSnapshot,
): Promise<void> {
  await syncSessionIndexEntryForThread(scopeKey, sessionId, thread);
  await writeSessionThreadFileSnapshot(scopeKey, sessionId, {
    version: CHAT_THREAD_VERSION,
    thread,
  });
}

export async function deleteSessionThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  sessionId: string,
): Promise<void> {
  if (pendingSessionPersist?.scopeKey === scopeKey && pendingSessionPersist.sessionId === sessionId) {
    pendingSessionPersist = null;
  }

  try {
    const threadPath = await getSessionThreadFilePath(scopeKey, sessionId);
    await remove(threadPath);
  } catch {
    // missing thread file is fine for drafts and already-deleted sessions
  }
}

export async function deleteSessionPersistence(
  scopeKey: ChatScopeKey,
  sessionId: string,
): Promise<void> {
  await deleteSessionThreadFileSnapshot(scopeKey, sessionId);
  const currentIndex = await readWorkspaceSessionsIndexSnapshot(scopeKey);
  const nextIndex = removeSessionIndexEntry(currentIndex, sessionId);
  await writeWorkspaceSessionsIndexSnapshot(scopeKey, nextIndex);
}

export function scheduleSessionThreadFilePersistence(
  scopeKey: ChatScopeKey,
  sessionId: string,
  snapshot: ChatSessionThreadFileSnapshot,
): void {
  pendingSessionPersist = { scopeKey, sessionId, snapshot };
  if (sessionPersistTimer) {
    clearTimeout(sessionPersistTimer);
  }
  sessionPersistTimer = setTimeout(() => {
    const next = pendingSessionPersist;
    pendingSessionPersist = null;
    sessionPersistTimer = null;
    if (!next) {
      return;
    }
    void persistSessionThreadSnapshot(next.scopeKey, next.sessionId, next.snapshot.thread);
  }, PERSIST_DEBOUNCE_MS);
}

export function scheduleWorkspaceSessionsIndexPersistence(
  scopeKey: ChatScopeKey,
  snapshot: WorkspaceSessionsIndexSnapshot,
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
    void writeWorkspaceSessionsIndexSnapshot(next.scopeKey, next.snapshot);
  }, PERSIST_DEBOUNCE_MS);
}

export {
  chatScopeStorageSegment,
  CHAT_RETENTION_MAX_TURNS,
  countConversationTurns,
  decodeChatSessionThreadFileSnapshot,
  decodeWorkspaceSessionsIndexSnapshot,
  encodeChatSessionThreadFileSnapshot,
  encodeWorkspaceSessionsIndexSnapshot,
  getSessionThreadFilePath,
  getWorkspaceSessionsDir,
  getWorkspaceSessionsIndexFilePath,
  needsChatCompaction,
  removeSessionIndexEntry,
  upsertSessionIndexEntry,
  workspaceChatPathHashKey,
};
