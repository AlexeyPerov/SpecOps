import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatThreadSnapshot } from "../domain/contracts";
import {
  compactChatMessages,
  compactChatThread,
  isProtectedCompactionMessage,
} from "./chatRetention";

function userMessage(id: string): ChatMessage {
  return {
    id: `u-${id}`,
    role: "user",
    content: `user-${id}`,
    createdAt: `2026-05-26T00:00:${id.padStart(2, "0")}.000Z`,
  };
}

function assistantMessage(id: string): ChatMessage {
  return {
    id: `a-${id}`,
    role: "assistant",
    content: `assistant-${id}`,
    createdAt: `2026-05-26T00:01:${id.padStart(2, "0")}.000Z`,
  };
}

function systemNotice(id: string): ChatMessage {
  return {
    id: `s-${id}`,
    role: "system",
    content: `notice-${id}`,
    createdAt: `2026-05-26T00:02:${id.padStart(2, "0")}.000Z`,
  };
}

function providerSwitchEvent(id: string): ChatMessage {
  return {
    id: `evt-${id}`,
    role: "system",
    content: "provider changed",
    createdAt: `2026-05-26T00:03:${id.padStart(2, "0")}.000Z`,
    systemEvent: {
      type: "provider-switched",
      fromProvider: "glm",
      toProvider: "cursor",
    },
  };
}

function threadWithMessages(messages: ChatMessage[]): ChatThreadSnapshot {
  return {
    metadata: {
      mode: "ask",
      provider: "glm",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      summary: "existing summary",
    },
    messages,
  };
}

describe("chat FIFO compaction", () => {
  it("does not change messages when under cap", () => {
    const messages = [userMessage("1"), assistantMessage("1"), userMessage("2")];
    const result = compactChatMessages(messages, 2);

    expect(result.removedMessages).toEqual([]);
    expect(result.messages).toEqual(messages);
  });

  it("removes oldest turn first and keeps newest messages", () => {
    const messages = [
      userMessage("1"),
      assistantMessage("1"),
      userMessage("2"),
      assistantMessage("2"),
      userMessage("3"),
    ];

    const result = compactChatMessages(messages, 2);

    expect(result.removedMessages.map((message) => message.id)).toEqual(["u-1", "a-1"]);
    expect(result.messages.map((message) => message.id)).toEqual(["u-2", "a-2", "u-3"]);
  });

  it("removes multiple oldest turns deterministically until under cap", () => {
    const messages = [
      userMessage("1"),
      userMessage("2"),
      userMessage("3"),
      userMessage("4"),
    ];

    const result = compactChatMessages(messages, 1);

    expect(result.messages.map((message) => message.id)).toEqual(["u-4"]);
    expect(result.removedMessages.map((message) => message.id)).toEqual(["u-1", "u-2", "u-3"]);
  });

  it("preserves thread metadata while compacting messages", () => {
    const thread = threadWithMessages([
      userMessage("1"),
      userMessage("2"),
      userMessage("3"),
    ]);

    const result = compactChatThread(thread, { maxTurns: 1 });

    expect(result.thread.metadata).toEqual(thread.metadata);
    expect(result.thread.messages.map((message) => message.id)).toEqual(["u-3"]);
  });

  it("drops plain system notices with oldest content but keeps provider system events", () => {
    const messages = [
      systemNotice("1"),
      userMessage("1"),
      assistantMessage("1"),
      providerSwitchEvent("1"),
      userMessage("2"),
      userMessage("3"),
    ];

    const result = compactChatMessages(messages, 1);

    expect(result.removedMessages.map((message) => message.id)).toEqual([
      "s-1",
      "u-1",
      "a-1",
      "u-2",
    ]);
    expect(result.messages.map((message) => message.id)).toEqual(["evt-1", "u-3"]);
    expect(isProtectedCompactionMessage(providerSwitchEvent("1"))).toBe(true);
  });
});
