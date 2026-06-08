import type { AgentIndexEntry, ChatMessage, ChatThreadSnapshot } from "../domain/contracts";

export const DRAFT_AGENT_TITLE = "New agent";
export const DRAFT_CHAT_TITLE = "New chat";

export function draftEntryTitleForScope(scopeKey: string | null | undefined): string {
  return scopeKey === "chat-http" ? DRAFT_CHAT_TITLE : DRAFT_AGENT_TITLE;
}
export const AGENT_TITLE_MAX_LENGTH = 64;
export const SIDEBAR_LIST_TEXT_MAX_LENGTH = 32;

export type AgentDateGroup = "today" | "yesterday" | "last-7-days" | "older";

export const AGENT_DATE_GROUP_LABELS: Record<AgentDateGroup, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "last-7-days": "Last 7 days",
  older: "Older",
};

export const AGENT_DATE_GROUP_ORDER: readonly AgentDateGroup[] = [
  "today",
  "yesterday",
  "last-7-days",
  "older",
];

const MS_PER_DAY = 86_400_000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function truncateAgentTitle(title: string, maxLength = AGENT_TITLE_MAX_LENGTH): string {
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

export function deriveAgentSubtitleFromMessages(
  messages: readonly ChatMessage[],
): string | null {
  const content = firstAssistantMessageContent(messages);
  if (!content) {
    return null;
  }
  return truncateWithEllipsis(content);
}

export function deriveAgentSubtitleFromThread(thread: ChatThreadSnapshot | null): string | null {
  if (!thread || thread.messages.length === 0) {
    return null;
  }
  return deriveAgentSubtitleFromMessages(thread.messages);
}

export function firstLineOfText(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

export function deriveAgentTitle(options: {
  isDraft?: boolean;
  firstUserMessage?: string | null;
}): string {
  if (options.isDraft) {
    return DRAFT_AGENT_TITLE;
  }
  const firstLine = firstLineOfText(options.firstUserMessage ?? "");
  if (!firstLine) {
    return DRAFT_AGENT_TITLE;
  }
  return truncateAgentTitle(firstLine);
}

export function deriveAgentTitleFromThread(thread: ChatThreadSnapshot | null): string {
  if (!thread || thread.messages.length === 0) {
    return DRAFT_AGENT_TITLE;
  }
  const firstUserMessage = thread.messages.find((message) => message.role === "user");
  return deriveAgentTitle({ firstUserMessage: firstUserMessage?.content ?? null });
}

export function deriveAgentTitleFromMessages(messages: readonly ChatMessage[]): string {
  if (messages.length === 0) {
    return DRAFT_AGENT_TITLE;
  }
  const firstUserMessage = messages.find((message) => message.role === "user");
  return deriveAgentTitle({ firstUserMessage: firstUserMessage?.content ?? null });
}

export function classifyAgentDateGroup(lastUsedAt: string, now = new Date()): AgentDateGroup {
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

export function groupAgentsByLastUsedDate(
  agents: readonly AgentIndexEntry[],
  now = new Date(),
): Record<AgentDateGroup, AgentIndexEntry[]> {
  const groups: Record<AgentDateGroup, AgentIndexEntry[]> = {
    today: [],
    yesterday: [],
    "last-7-days": [],
    older: [],
  };

  const sorted = [...agents].sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
  for (const agent of sorted) {
    groups[classifyAgentDateGroup(agent.lastUsedAt, now)].push(agent);
  }

  return groups;
}

export function filterAgentsByTitle(
  agents: readonly AgentIndexEntry[],
  query: string,
): AgentIndexEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [...agents];
  }
  return agents.filter((agent) => agent.title.toLowerCase().includes(normalizedQuery));
}
