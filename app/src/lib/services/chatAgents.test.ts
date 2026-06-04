import { describe, expect, it } from "vitest";
import type { AgentIndexEntry, ChatMessage } from "../domain/contracts";
import {
  AGENT_DATE_GROUP_ORDER,
  AGENT_TITLE_MAX_LENGTH,
  classifyAgentDateGroup,
  deriveAgentTitle,
  deriveAgentTitleFromMessages,
  deriveAgentTitleFromThread,
  DRAFT_AGENT_TITLE,
  filterAgentsByTitle,
  groupAgentsByLastUsedDate,
  truncateAgentTitle,
} from "./chatAgents";

function userMessage(content: string, id = "m-1"): ChatMessage {
  return {
    id,
    role: "user",
    content,
    createdAt: "2026-05-28T12:00:00.000Z",
  };
}

describe("agent title helpers", () => {
  it("uses New agent for drafts", () => {
    expect(deriveAgentTitle({ isDraft: true })).toBe(DRAFT_AGENT_TITLE);
  });

  it("derives title from first user message line", () => {
    expect(deriveAgentTitle({ firstUserMessage: "Explain this API\nand edge cases" })).toBe(
      "Explain this API",
    );
  });

  it("truncates long first lines", () => {
    const longLine = "x".repeat(80);
    expect(truncateAgentTitle(longLine)).toHaveLength(AGENT_TITLE_MAX_LENGTH);
    expect(deriveAgentTitle({ firstUserMessage: longLine })).toHaveLength(AGENT_TITLE_MAX_LENGTH);
  });

  it("derives title from thread messages", () => {
    const thread = {
      metadata: {
        agentId: "agent-1",
        threadId: "agent-1",
        mode: "ask" as const,
        provider: "http" as const,
        createdAt: "2026-05-28T12:00:00.000Z",
        updatedAt: "2026-05-28T12:00:00.000Z",
      },
      messages: [userMessage("Review auth flow")],
    };

    expect(deriveAgentTitleFromThread(thread)).toBe("Review auth flow");
    expect(deriveAgentTitleFromThread(null)).toBe(DRAFT_AGENT_TITLE);
    expect(deriveAgentTitleFromMessages([])).toBe(DRAFT_AGENT_TITLE);
  });
});

describe("agent date grouping", () => {
  const now = new Date("2026-05-28T15:00:00.000Z");

  const agents: AgentIndexEntry[] = [
    { id: "a-today", title: "Today agent", lastUsedAt: "2026-05-28T10:00:00.000Z" },
    { id: "a-yesterday", title: "Yesterday agent", lastUsedAt: "2026-05-27T10:00:00.000Z" },
    { id: "a-week", title: "Week agent", lastUsedAt: "2026-05-22T10:00:00.000Z" },
    { id: "a-old", title: "Old agent", lastUsedAt: "2026-05-01T10:00:00.000Z" },
  ];

  it("classifies lastUsedAt into date buckets", () => {
    expect(classifyAgentDateGroup("2026-05-28T10:00:00.000Z", now)).toBe("today");
    expect(classifyAgentDateGroup("2026-05-27T10:00:00.000Z", now)).toBe("yesterday");
    expect(classifyAgentDateGroup("2026-05-22T10:00:00.000Z", now)).toBe("last-7-days");
    expect(classifyAgentDateGroup("2026-05-01T10:00:00.000Z", now)).toBe("older");
  });

  it("groups agents by last used date in descending order within each bucket", () => {
    const grouped = groupAgentsByLastUsedDate(agents, now);

    for (const group of AGENT_DATE_GROUP_ORDER) {
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
    const withDrafts: AgentIndexEntry[] = [
      ...agents,
      { id: "draft-1", title: DRAFT_AGENT_TITLE, lastUsedAt: "2026-05-28T11:00:00.000Z" },
    ];

    expect(filterAgentsByTitle(withDrafts, "new agent").map((entry) => entry.id)).toEqual(["draft-1"]);
    expect(filterAgentsByTitle(withDrafts, "week").map((entry) => entry.id)).toEqual(["a-week"]);
  });
});
