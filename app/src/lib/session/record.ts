/**
 * Persistence record shapes for the runtime-neutral session store (phase B).
 *
 * These on-disk records are the schema phase C/D adapters and phase F UI
 * persist and restore. They center on the native binding + cached transcript
 * and deliberately carry no provider-prefixed fields (`opencode*` /
 * `chat-http` artifacts are gone). Versioned envelopes let later phases bump
 * the version without silent partial decodes.
 */

import type { AgentRuntimeId } from "./runtime";
import type {
  AgentNativeBinding,
  AgentSessionRef,
  SessionLifecycleStatus,
} from "./binding";
import type { NativeSessionId, SpecOpsSessionId } from "./ids";
import type { SessionTranscript } from "./transcript";

/** On-disk envelope version for a single session record file. */
export const SESSION_RECORD_VERSION = 1 as const;

/** On-disk envelope version for a per-workspace session-store index. */
export const SESSION_STORE_INDEX_VERSION = 1 as const;

/**
 * Persisted session record: the session ref + cached transcript. One file per
 * session; the transcript is the rendered replay source.
 */
export interface SessionRecord {
  readonly version: typeof SESSION_RECORD_VERSION;
  readonly session: AgentSessionRef;
  readonly transcript: SessionTranscript;
}

/**
 * Lightweight index entry (no transcript). The index lists sessions per
 * workspace so the sidebar/rail can render without reading every record file.
 */
export interface SessionStoreIndexEntry {
  readonly id: SpecOpsSessionId;
  readonly runtimeId: AgentRuntimeId;
  readonly nativeSessionId: NativeSessionId;
  readonly title: string;
  readonly lastTurnAt: string;
  readonly status: SessionLifecycleStatus;
  readonly parentSessionId?: SpecOpsSessionId;
}

export interface SessionStoreIndex {
  readonly version: typeof SESSION_STORE_INDEX_VERSION;
  readonly workspaceRootPath: string;
  readonly sessions: readonly SessionStoreIndexEntry[];
}

/** Project an index entry from a session ref (no transcript read needed). */
export function toSessionStoreIndexEntry(
  session: AgentSessionRef,
  title: string,
): SessionStoreIndexEntry {
  const { native } = session;
  return {
    id: session.id,
    runtimeId: session.runtimeId,
    nativeSessionId: native.nativeSessionId,
    title,
    lastTurnAt: session.lastTurnAt ?? session.updatedAt,
    status: session.status,
    ...(native.parentSessionId !== undefined ? { parentSessionId: native.parentSessionId } : {}),
  };
}

export function createSessionStoreIndex(
  workspaceRootPath: string,
  sessions: readonly SessionStoreIndexEntry[] = [],
): SessionStoreIndex {
  return {
    version: SESSION_STORE_INDEX_VERSION,
    workspaceRootPath,
    sessions: [...sessions],
  };
}

export function upsertSessionStoreIndexEntry(
  index: SessionStoreIndex,
  entry: SessionStoreIndexEntry,
): SessionStoreIndex {
  const without = index.sessions.filter((session) => session.id !== entry.id);
  return { ...index, sessions: [...without, entry] };
}

export function removeSessionStoreIndexEntry(
  index: SessionStoreIndex,
  sessionId: SpecOpsSessionId,
): SessionStoreIndex {
  return { ...index, sessions: index.sessions.filter((session) => session.id !== sessionId) };
}

// Re-export the binding type for codec consumers that construct records directly.
export type { AgentNativeBinding };
