import { describe, expect, it } from "vitest";
import type { SessionIndexEntry, ChatMessage } from "../domain/contracts";
import {
  SESSION_DATE_GROUP_ORDER,
  SESSION_TITLE_MAX_LENGTH,
  classifySessionDateGroup,
  deriveSessionSubtitleFromMessages,
  deriveSessionSubtitleFromThread,
  deriveSessionTitle,
  deriveSessionTitleFromMessages,
  deriveSessionTitleFromThread,
  DRAFT_SESSION_TITLE,
  filterSessionsByTitle,
  formatSidebarListTitle,
  groupSessionsByLastUsedDate,
  SIDEBAR_LIST_TEXT_MAX_LENGTH,
  truncateSessionTitle,
  truncateWithEllipsis,
} from "./chatSessions";

function userMessage(content: string, id = "m-1"): ChatMessage {
  return {
    id,
    role: "user",
    content,
    createdAt: "2026-05-28T12:00:00.000Z",
  };
}

function assistantMessage(content: string, id = "m-2"): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    createdAt: "2026-05-28T12:00:01.000Z",
  };
}

describe("agent title helpers", () => {
  it("uses New session for drafts", () => {
    expect(deriveSessionTitle({ isDraft: true })).toBe(DRAFT_SESSION_TITLE);
  });

  it("derives title from first user message line", () => {
    expect(deriveSessionTitle({ firstUserMessage: "Explain this API\nand edge cases" })).toBe(
      "Explain this API",
    );
  });

  it("truncates long first lines", () => {
    const longLine = "x".repeat(80);
    expect(truncateSessionTitle(longLine)).toHaveLength(SESSION_TITLE_MAX_LENGTH);
    expect(deriveSessionTitle({ firstUserMessage: longLine })).toHaveLength(SESSION_TITLE_MAX_LENGTH);
  });

  it("derives title from thread messages", () => {
    const thread = {
      metadata: {
        sessionId: "agent-1",
        threadId: "agent-1",
        mode: "ask" as const,
        provider: "http" as const,
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
      messages: [userMessage("Review auth flow")],
    };

    expect(deriveSessionTitleFromThread(thread)).toBe("Review auth flow");
    expect(deriveSessionTitleFromThread(null)).toBe(DRAFT_SESSION_TITLE);
    expect(deriveSessionTitleFromMessages([])).toBe(DRAFT_SESSION_TITLE);
  });
});

describe("sidebar list text helpers", () => {
  it("leaves text at or below max length unchanged", () => {
    const exact = "x".repeat(SIDEBAR_LIST_TEXT_MAX_LENGTH);
    expect(truncateWithEllipsis(exact)).toBe(exact);
    expect(formatSidebarListTitle(exact)).toBe(exact);
  });

  it("appends ellipsis when text exceeds max length", () => {
    const long = "x".repeat(SIDEBAR_LIST_TEXT_MAX_LENGTH + 1);
    expect(truncateWithEllipsis(long)).toBe(`${"x".repeat(SIDEBAR_LIST_TEXT_MAX_LENGTH)}...`);
    expect(formatSidebarListTitle(long)).toBe(`${"x".repeat(SIDEBAR_LIST_TEXT_MAX_LENGTH)}...`);
  });

  it("derives subtitle from first assistant message", () => {
    const longReply = "a".repeat(SIDEBAR_LIST_TEXT_MAX_LENGTH + 5);
    const messages = [userMessage("Hello"), assistantMessage(longReply)];
    expect(deriveSessionSubtitleFromMessages(messages)).toBe(
      `${"a".repeat(SIDEBAR_LIST_TEXT_MAX_LENGTH)}...`,
    );
    expect(deriveSessionSubtitleFromMessages([userMessage("Only user")])).toBeNull();
    expect(deriveSessionSubtitleFromMessages([assistantMessage("   ")])).toBeNull();
  });

  it("derives subtitle from thread messages", () => {
    const thread = {
      metadata: {
        sessionId: "agent-1",
        threadId: "agent-1",
        mode: "ask" as const,
        provider: "http" as const,
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
      messages: [userMessage("Question"), assistantMessage("Short reply")],
    };

    expect(deriveSessionSubtitleFromThread(thread)).toBe("Short reply");
    expect(deriveSessionSubtitleFromThread(null)).toBeNull();
  });
});

describe("agent date grouping", () => {
  const now = new Date("2026-05-28T15:00:00.000Z");

  const agents: SessionIndexEntry[] = [
    { id: "a-today", title: "Today agent", lastUsedAt: "2026-05-28T10:00:00.000Z" },
    { id: "a-yesterday", title: "Yesterday agent", lastUsedAt: "2026-05-27T10:00:00.000Z" },
    { id: "a-week", title: "Week agent", lastUsedAt: "2026-05-22T10:00:00.000Z" },
    { id: "a-old", title: "Old agent", lastUsedAt: "2026-05-01T10:00:00.000Z" },
  ];

  it("classifies lastUsedAt into date buckets", () => {
    expect(classifySessionDateGroup("2026-05-28T10:00:00.000Z", now)).toBe("today");
    expect(classifySessionDateGroup("2026-05-27T10:00:00.000Z", now)).toBe("yesterday");
    expect(classifySessionDateGroup("2026-05-22T10:00:00.000Z", now)).toBe("last-7-days");
    expect(classifySessionDateGroup("2026-05-01T10:00:00.000Z", now)).toBe("older");
  });

  it("groups agents by last used date in descending order within each bucket", () => {
    const grouped = groupSessionsByLastUsedDate(agents, now);

    for (const group of SESSION_DATE_GROUP_ORDER) {
      const entries = grouped[group];
      for (let index = 1; index < entries.length; index += 1) {
        expect(entries[index - 1]!.lastUsedAt.localeCompare(entries[index]!.lastUsedAt)).toBeGreaterThanOrEqual(
          0,
        );
      }
    }

    expect(grouped.today.map((entry) => entry.id)).toEqual(["a-today"]);
    expect(grouped.yesterday.map((entry) => entry.id)).toEqual(["a-yesterday"]);
    expect(grouped["last-7-days"].map((entry) => entry.id)).toEqual(["a-week"]);
    expect(grouped.older.map((entry) => entry.id)).toEqual(["a-old"]);
  });

  it("filters agents by title only", () => {
    const withDrafts: SessionIndexEntry[] = [
      ...agents,
      { id: "draft-1", title: DRAFT_SESSION_TITLE, lastUsedAt: "2026-05-28T11:00:00.000Z" },
    ];

    expect(filterSessionsByTitle(withDrafts, "new session").map((entry) => entry.id)).toEqual(["draft-1"]);
    expect(filterSessionsByTitle(withDrafts, "week").map((entry) => entry.id)).toEqual(["a-week"]);
  });
});
