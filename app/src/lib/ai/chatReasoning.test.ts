import { describe, expect, it } from "vitest";
import { extractMessageReasoning } from "./chatReasoning";
import type { ChatMessage, ChatMessagePart } from "../domain/contracts";

function assistantMessage(parts: ChatMessagePart[], content = ""): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content,
    createdAt: "2026-06-16T00:00:00.000Z",
    parts,
  };
}

describe("extractMessageReasoning", () => {
  it("returns null when the message has no parts", () => {
    expect(extractMessageReasoning(assistantMessage([], "just text"))).toBeNull();
  });

  it("returns null when parts has no reasoning part", () => {
    const message = assistantMessage(
      [
        { type: "text", id: "t1", text: "answer" },
        { type: "step", phase: "finish", cost: 0.01 },
      ],
      "answer",
    );
    expect(extractMessageReasoning(message)).toBeNull();
  });

  it("joins a single reasoning part into a block", () => {
    const message = assistantMessage(
      [
        { type: "reasoning", id: "r1", text: "thinking about the user request" },
        { type: "text", id: "t1", text: "final answer" },
      ],
      "final answer",
    );
    expect(extractMessageReasoning(message)).toEqual({
      id: "r1",
      text: "thinking about the user request",
    });
  });

  it("joins multiple reasoning parts with a blank line, in arrival order", () => {
    const message = assistantMessage([
      { type: "reasoning", id: "r1", text: "step one" },
      { type: "reasoning", id: "r2", text: "step two" },
      { type: "reasoning", id: "r3", text: "step three" },
    ]);
    expect(extractMessageReasoning(message)).toEqual({
      id: "r1|r2|r3",
      text: "step one\n\nstep two\n\nstep three",
    });
  });

  it("falls back to the message id when no part ids are present", () => {
    const message = assistantMessage([{ type: "reasoning", text: "no id here" }]);
    expect(extractMessageReasoning(message)).toEqual({
      id: "msg-1",
      text: "no id here",
    });
  });

  it("ignores part ids that are empty strings", () => {
    const message = assistantMessage([
      { type: "reasoning", id: "", text: "a" },
      { type: "reasoning", id: "r2", text: "b" },
    ]);
    expect(extractMessageReasoning(message)?.id).toBe("r2");
  });

  it("returns null when all reasoning parts are whitespace-only", () => {
    const message = assistantMessage([
      { type: "reasoning", id: "r1", text: "   " },
      { type: "reasoning", id: "r2", text: "\n\t" },
    ]);
    expect(extractMessageReasoning(message)).toBeNull();
  });

  it("drops whitespace-only reasoning parts but keeps the non-empty ones", () => {
    const message = assistantMessage([
      { type: "reasoning", id: "r1", text: "   " },
      { type: "reasoning", id: "r2", text: "keep" },
      { type: "reasoning", id: "r3", text: "\n\t" },
      { type: "reasoning", id: "r4", text: "me too" },
    ]);
    expect(extractMessageReasoning(message)).toEqual({
      id: "r2|r4",
      text: "keep\n\nme too",
    });
  });

  it("ignores user/system roles only by virtue of having no reasoning parts in their payloads", () => {
    const userMessage: ChatMessage = {
      id: "u1",
      role: "user",
      content: "hi",
      createdAt: "2026-06-16T00:00:00.000Z",
      parts: [{ type: "text", text: "hi" }],
    };
    expect(extractMessageReasoning(userMessage)).toBeNull();
  });
});
