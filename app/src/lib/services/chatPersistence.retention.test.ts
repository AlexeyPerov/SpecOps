import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../domain/contracts";
import {
  CHAT_RETENTION_MAX_TURNS,
  countConversationTurns,
  needsChatCompaction,
} from "./chatPersistence";

function userMessage(id: string): ChatMessage {
  return {
    id,
    role: "user",
    content: `user-${id}`,
    createdAt: `2026-05-26T00:00:${id.padStart(2, "0")}.000Z`,
  };
}

function assistantMessage(id: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content: `assistant-${id}`,
    createdAt: `2026-05-26T00:01:${id.padStart(2, "0")}.000Z`,
  };
}

describe("chat retention policy constants", () => {
  it("uses a centralized turn cap aligned with requirements", () => {
    expect(CHAT_RETENTION_MAX_TURNS).toBe(50);
  });

  it("counts turns by user messages only", () => {
    const messages: ChatMessage[] = [
      userMessage("1"),
      assistantMessage("1"),
      {
        id: "system-1",
        role: "system",
        content: "provider changed",
        createdAt: "2026-05-26T00:00:03.000Z",
        systemEvent: {
          type: "provider-switched",
          fromProvider: "http",
          toProvider: "debug-workspace",
        },
      },
      userMessage("2"),
    ];

    expect(countConversationTurns(messages)).toBe(2);
  });

  it("reports compaction need only when turn count exceeds cap", () => {
    const underCap = [userMessage("1"), assistantMessage("1")];
    const overCap = [userMessage("1"), userMessage("2"), userMessage("3")];

    expect(needsChatCompaction(underCap, 2)).toBe(false);
    expect(needsChatCompaction(overCap, 2)).toBe(true);
    expect(needsChatCompaction(overCap)).toBe(false);
  });
});
