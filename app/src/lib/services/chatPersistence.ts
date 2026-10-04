import { readTextFile, remove } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import type {
  ChatSessionThreadFileSnapshot,
  ChatThreadSnapshot,
  WorkspaceSessionsIndexSnapshot,
} from "../domain/contracts";
import type { ChatScopeKey } from "../state/chatStore/types";
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

const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const indexTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clears debounce state between tests. */
export function resetChatPersistenceForTests(): void {
  for (const timer of [...sessionTimers.values(), ...indexTimers.values()]) clearTimeout(timer);
  sessionTimers.clear();
  indexTimers.clear();
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

const indexWrites = new Map<string, Promise<unknown>>();
function queueIndexWrite<T>(scope: string, work: () => Promise<T>): Promise<T> {
  const next = (indexWrites.get(scope) ?? Promise.resolve()).catch(() => {}).then(work);
  indexWrites.set(scope, next);
  void next.finally(() => { if (indexWrites.get(scope) === next) indexWrites.delete(scope); }).catch(() => {});
  return next;
}

export function persistSessionIndexEntry(scope: ChatScopeKey, entry: WorkspaceSessionsIndexSnapshot["sessions"][number]): Promise<void> {
  return queueIndexWrite(scope, async () => {
    const current = await readWorkspaceSessionsIndexSnapshot(scope);
    await writeIndex(scope, upsertSessionIndexEntry(current, entry));
  });
}

export function writeWorkspaceSessionsIndexSnapshot(scopeKey: ChatScopeKey, snapshot: WorkspaceSessionsIndexSnapshot): Promise<void> {
  return queueIndexWrite(scopeKey, () => writeIndex(scopeKey, snapshot));
}

async function writeIndex(
  scopeKey: ChatScopeKey,
  snapshot: WorkspaceSessionsIndexSnapshot,
): Promise<void> {
  const indexPath = await getWorkspaceSessionsIndexFilePath(scopeKey);
  await atomicWriteTextFile(indexPath, encodeWorkspaceSessionsIndexSnapshot(snapshot));
}

export async function readSessionThreadFileSnapshot(
  scopeKey: ChatScopeKey,
  sessionId: string,
): Promise<ChatThreadSnapshot | null> {
  try {
    const threadPath = await getSessionThreadFilePath(scopeKey, sessionId);
    const raw = await readTextFile(threadPath);
    const decoded = decodeChatSessionThreadFileSnapshot(raw);
    return decoded?.thread ?? null;
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
  await atomicWriteTextFile(threadPath, encodeChatSessionThreadFileSnapshot(snapshot));
}

export async function syncSessionIndexEntryForThread(
  scopeKey: ChatScopeKey,
  sessionId: string,
  thread: ChatThreadSnapshot,
): Promise<WorkspaceSessionsIndexSnapshot> {
  return queueIndexWrite(scopeKey, async () => {
    const currentIndex = await readWorkspaceSessionsIndexSnapshot(scopeKey);
    const nextIndex = upsertSessionIndexEntry(currentIndex, {
      ...currentIndex.sessions.find((entry) => entry.id === sessionId),
      id: sessionId,
      isDraft: false,
      title: deriveSessionTitleFromThread(thread),
      lastUsedAt: thread.metadata.updatedAt,
    });
    await writeIndex(scopeKey, nextIndex);
    return nextIndex;
  });
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
  const key = `${scopeKey}\0${sessionId}`;
  clearTimeout(sessionTimers.get(key));
  sessionTimers.delete(key);

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
  await queueIndexWrite(scopeKey, async () => {
    const currentIndex = await readWorkspaceSessionsIndexSnapshot(scopeKey);
    await writeIndex(scopeKey, removeSessionIndexEntry(currentIndex, sessionId));
  });
}

export function scheduleSessionThreadFilePersistence(
  scopeKey: ChatScopeKey,
  sessionId: string,
  snapshot: ChatSessionThreadFileSnapshot,
): void {
  const key = `${scopeKey}\0${sessionId}`;
  clearTimeout(sessionTimers.get(key));
  sessionTimers.set(key, setTimeout(() => {
    sessionTimers.delete(key);
    void persistSessionThreadSnapshot(scopeKey, sessionId, snapshot.thread).catch(() => {
      console.error("Session persistence failed");
    });
  }, PERSIST_DEBOUNCE_MS));
}

export function scheduleWorkspaceSessionsIndexPersistence(scopeKey: ChatScopeKey, snapshot: WorkspaceSessionsIndexSnapshot): void {
  clearTimeout(indexTimers.get(scopeKey));
  indexTimers.set(scopeKey, setTimeout(() => {
    indexTimers.delete(scopeKey);
    void writeWorkspaceSessionsIndexSnapshot(scopeKey, snapshot).catch(() => {
      console.error("Session index persistence failed");
    });
  }, PERSIST_DEBOUNCE_MS));
}

/** Await the production binding writer before sending a native turn. */
export async function flushSessionIndexPersistence(scopeKey: ChatScopeKey): Promise<void> {
  await indexWrites.get(scopeKey);
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
