import type { ChatMessage, ChatThreadSnapshot, SessionIndexEntry } from "../domain/contracts";
import { extractSessionTotals } from "../ai/chatSteps";
import { formatCost } from "../ai/chatTokenFormat";

export const DRAFT_SESSION_TITLE = "New session";
export const DRAFT_CHAT_TITLE = "New chat";

export function draftEntryTitleForScope(scopeKey: string | null | undefined): string {
  return scopeKey === "chat-http" ? DRAFT_CHAT_TITLE : DRAFT_SESSION_TITLE;
}
export const SESSION_TITLE_MAX_LENGTH = 64;
export const SIDEBAR_LIST_TEXT_MAX_LENGTH = 32;

export type SessionDateGroup = "today" | "yesterday" | "last-7-days" | "older";

export const SESSION_DATE_GROUP_LABELS: Record<SessionDateGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "last-7-days": "Last 7 days",
  older: "Older",
};

export const SESSION_DATE_GROUP_ORDER: readonly SessionDateGroup[] = [
  "today",
  "yesterday",
  "last-7-days",
  "older",
];

const MS_PER_DAY = 86_400_000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function truncateSessionTitle(title: string, maxLength = SESSION_TITLE_MAX_LENGTH): string {
  if (title.length <= maxLength) {
    return title;
  }
  return title.slice(0, maxLength);
}

export function truncateWithEllipsis(
  text: string,
  maxLength = SIDEBAR_LIST_TEXT_MAX_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export function formatSidebarListTitle(title: string): string {
  return truncateWithEllipsis(title);
}

export function firstAssistantMessageContent(messages: readonly ChatMessage[]): string | null {
  const firstAssistant = messages.find((message) => message.role === "assistant");
  const content = firstAssistant?.content.trim() ?? "";
  return content || null;
}

export function deriveSessionSubtitleFromMessages(
  messages: readonly ChatMessage[],
): string | null {
  const content = firstAssistantMessageContent(messages);
  // M2-T8: append the cumulative session cost (when present) so each sidebar
  // row carries a per-session cost hint alongside the first-response preview.
  const totals = extractSessionTotals(messages);
  const costSuffix = totals && totals.cost > 0 ? ` · ${formatCost(totals.cost)}` : "";
  if (!content && !costSuffix) {
    return null;
  }
  const preview = content ? truncateWithEllipsis(content) : "";
  return `${preview}${costSuffix}`.trim() || null;
}

export function deriveSessionSubtitleFromThread(thread: ChatThreadSnapshot | null): string | null {
  if (!thread || thread.messages.length === 0) {
    return null;
  }
  return deriveSessionSubtitleFromMessages(thread.messages);
}

export function firstLineOfText(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

export function deriveSessionTitle(options: {
  isDraft?: boolean;
  firstUserMessage?: string | null;
}): string {
  if (options.isDraft) {
    return DRAFT_SESSION_TITLE;
  }
  const firstLine = firstLineOfText(options.firstUserMessage ?? "");
  if (!firstLine) {
    return DRAFT_SESSION_TITLE;
  }
  return truncateSessionTitle(firstLine);
}

export function deriveSessionTitleFromThread(thread: ChatThreadSnapshot | null): string {
  if (!thread || thread.messages.length === 0) {
    return DRAFT_SESSION_TITLE;
  }
  const firstUserMessage = thread.messages.find((message) => message.role === "user");
  return deriveSessionTitle({ firstUserMessage: firstUserMessage?.content ?? null });
}

export function deriveSessionTitleFromMessages(messages: readonly ChatMessage[]): string {
  if (messages.length === 0) {
    return DRAFT_SESSION_TITLE;
  }
  const firstUserMessage = messages.find((message) => message.role === "user");
  return deriveSessionTitle({ firstUserMessage: firstUserMessage?.content ?? null });
}

export function classifySessionDateGroup(lastUsedAt: string, now = new Date()): SessionDateGroup {
  const usedDay = startOfUtcDay(new Date(lastUsedAt));
  const todayStart = startOfUtcDay(now);
  const diffDays = Math.floor((todayStart.getTime() - usedDay.getTime()) / MS_PER_DAY);

  if (diffDays === 0) {
    return "today";
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays <= 7) {
    return "last-7-days";
  }
  return "older";
}

export function groupSessionsByLastUsedDate(
  sessions: readonly SessionIndexEntry[],
  now = new Date(),
): Record<SessionDateGroup, SessionIndexEntry[]> {
  const groups: Record<SessionDateGroup, SessionIndexEntry[]> = {
    today: [],
    yesterday: [],
    "last-7-days": [],
    older: [],
  };

  const sorted = [...sessions].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  for (const session of sorted) {
    groups[classifySessionDateGroup(session.lastUsedAt, now)].push(session);
  }

  return groups;
}

export function filterSessionsByTitle(
  sessions: readonly SessionIndexEntry[],
  query: string,
): SessionIndexEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...sessions];
  }
  return sessions.filter((session) => session.title.toLowerCase().includes(normalizedQuery));
}
