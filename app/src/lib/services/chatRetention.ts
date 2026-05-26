import type { ChatMessage, ChatThreadSnapshot } from "../domain/contracts";
import {
  CHAT_RETENTION_MAX_TURNS,
  countConversationTurns,
  needsChatCompaction,
} from "./chatPersistence";

export { CHAT_RETENTION_MAX_TURNS, countConversationTurns, needsChatCompaction };

let testMaxTurnsOverride: number | undefined;

/** Overrides retention cap in unit tests; pass `undefined` to reset. */
export function setChatRetentionMaxTurnsForTests(maxTurns?: number): void {
  testMaxTurnsOverride = maxTurns;
}

function resolveMaxTurns(maxTurns?: number): number {
  return maxTurns ?? testMaxTurnsOverride ?? CHAT_RETENTION_MAX_TURNS;
}

export interface ChatCompactionResult {
  thread: ChatThreadSnapshot;
  removedMessages: ChatMessage[];
}

/**
 * Messages removed during FIFO compaction:
 * - user and assistant messages in the oldest turn(s)
 * - plain system messages (no `systemEvent`, e.g. access-loss notices)
 *
 * Protected during compaction:
 * - thread metadata (handled outside the messages array)
 * - system messages carrying `systemEvent` markers (e.g. provider-switched)
 */
export function isProtectedCompactionMessage(message: ChatMessage): boolean {
  return message.role === "system" && message.systemEvent !== undefined;
}

function isDroppableCompactionMessage(message: ChatMessage): boolean {
  return !isProtectedCompactionMessage(message);
}

function findFirstUserIndex(messages: readonly ChatMessage[]): number {
  return messages.findIndex((message) => message.role === "user");
}

function findTurnEndIndex(messages: readonly ChatMessage[], turnStartIndex: number): number {
  let endIndex = turnStartIndex + 1;
  while (endIndex < messages.length && messages[endIndex].role !== "user") {
    endIndex += 1;
  }
  return endIndex;
}

function removeLeadingDroppableBeforeFirstTurn(messages: ChatMessage[]): ChatMessage[] {
  const firstUserIndex = findFirstUserIndex(messages);
  if (firstUserIndex <= 0) {
    return messages;
  }

  return messages.filter(
    (message, index) => index >= firstUserIndex || !isDroppableCompactionMessage(message),
  );
}

function removeOldestTurn(messages: ChatMessage[]): ChatMessage[] {
  const withoutLeadingDroppable = removeLeadingDroppableBeforeFirstTurn(messages);
  const firstUserIndex = findFirstUserIndex(withoutLeadingDroppable);
  if (firstUserIndex === -1) {
    return withoutLeadingDroppable;
  }

  const turnEndIndex = findTurnEndIndex(withoutLeadingDroppable, firstUserIndex);
  return withoutLeadingDroppable.filter((message, index) => {
    if (index < firstUserIndex || index >= turnEndIndex) {
      return true;
    }
    return !isDroppableCompactionMessage(message);
  });
}

export function compactChatMessages(
  messages: readonly ChatMessage[],
  maxTurns?: number,
): { messages: ChatMessage[]; removedMessages: ChatMessage[] } {
  const resolvedMaxTurns = resolveMaxTurns(maxTurns);
  let nextMessages = [...messages];
  const removedMessages: ChatMessage[] = [];

  while (countConversationTurns(nextMessages) > resolvedMaxTurns) {
    const beforeRemoval = nextMessages;
    const afterRemoval = removeOldestTurn(nextMessages);
    if (afterRemoval.length === beforeRemoval.length) {
      break;
    }

    const remainingIds = new Set(afterRemoval.map((message) => message.id));
    for (const message of beforeRemoval) {
      if (!remainingIds.has(message.id)) {
        removedMessages.push(message);
      }
    }
    nextMessages = afterRemoval;
  }

  return { messages: nextMessages, removedMessages };
}

export function compactChatThread(
  thread: ChatThreadSnapshot,
  options?: { maxTurns?: number; compactedAt?: string },
): ChatCompactionResult {
  const { messages, removedMessages } = compactChatMessages(thread.messages, options?.maxTurns);
  if (removedMessages.length === 0) {
    return { thread, removedMessages };
  }

  const compactedAt = options?.compactedAt ?? new Date().toISOString();
  const summary = appendCompactionSummary(thread.metadata.summary, removedMessages);
  const droppableRemovedCount = removedMessages.filter(isDroppableCompactionMessage).length;

  return {
    thread: {
      metadata: {
        ...thread.metadata,
        summary: summary || thread.metadata.summary,
        compactionCount: (thread.metadata.compactionCount ?? 0) + 1,
        lastCompactedAt: compactedAt,
        compactedMessageCount:
          (thread.metadata.compactedMessageCount ?? 0) + droppableRemovedCount,
        updatedAt: compactedAt,
      },
      messages,
    },
    removedMessages,
  };
}

const SUMMARY_LINE_MAX_LENGTH = 120;

function truncateSummaryLine(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  if (singleLine.length <= SUMMARY_LINE_MAX_LENGTH) {
    return singleLine;
  }
  return `${singleLine.slice(0, SUMMARY_LINE_MAX_LENGTH - 3)}...`;
}

function summaryMessagesFromRemoved(removedMessages: readonly ChatMessage[]): ChatMessage[] {
  return removedMessages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
}

/** MVP compaction summary: bullet list extracted from removed user/assistant turns. */
export function buildCompactionSummaryBullets(removedMessages: readonly ChatMessage[]): string {
  const lines: string[] = [];
  for (const message of summaryMessagesFromRemoved(removedMessages)) {
    const roleLabel = message.role === "user" ? "User" : "Assistant";
    lines.push(`- ${roleLabel}: ${truncateSummaryLine(message.content)}`);
  }
  return lines.join("\n");
}

export function appendCompactionSummary(
  existingSummary: string | undefined,
  removedMessages: readonly ChatMessage[],
): string {
  const bullets = buildCompactionSummaryBullets(removedMessages);
  if (!bullets) {
    return existingSummary?.trim() ?? "";
  }
  if (!existingSummary?.trim()) {
    return bullets;
  }
  return `${existingSummary.trim()}\n${bullets}`;
}

/** Shape consumed by future provider prompt-context builders (M5). */
export function buildThreadPromptContext(thread: ChatThreadSnapshot): {
  summary: string | undefined;
  recentMessages: ChatMessage[];
} {
  return {
    summary: thread.metadata.summary,
    recentMessages: thread.messages,
  };
}
