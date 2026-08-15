import type {
  ChatThreadMetadata,
  ChatThreadSnapshot,
} from "../../domain/contracts";

export function cloneThread(thread: ChatThreadSnapshot | null): ChatThreadSnapshot | null {
  if (!thread) {
    return null;
  }
  return {
    metadata: { ...thread.metadata },
    messages: thread.messages.map((message) => ({ ...message })),
  };
}

/**
 * Creates metadata for a new workspace session thread. Workspace threads carry
 * the per-thread model/mode selection; the runtime binding itself is owned by
 * the session index entry (phase B binding).
 */
export function createThreadMetadata(
  sessionId: string,
  createdAt: string,
): ChatThreadMetadata {
  return {
    sessionId,
    threadId: sessionId,
    createdAt,
    updatedAt: createdAt,
  };
}

export function applyMetadataPatch(
  metadata: ChatThreadMetadata,
  patch: Partial<
    Pick<
      ChatThreadMetadata,
      "summary" | "selectedModelId" | "selectedModeId" | "runtimeId"
    >
  >,
  updatedAt: string,
): ChatThreadMetadata {
  return {
    ...metadata,
    ...patch,
    updatedAt,
  };
}

export function formatCompactionNotice(compactedMessageCount: number): string {
  const label = compactedMessageCount === 1 ? "message" : "messages";
  return `${compactedMessageCount} older ${label} compacted to stay within chat retention limits.`;
}
