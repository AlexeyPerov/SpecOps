import { describe, expect, it } from "vitest";
import { extractMessageSubtasks } from "./chatSubtasks";
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

describe("extractMessageSubtasks", () => {
  it("returns an empty array when the message has no parts", () => {
    expect(extractMessageSubtasks(assistantMessage([], "just text"))).toEqual([]);
  });

  it("returns an empty array when parts has no subtask part", () => {
    const message = assistantMessage(
      [
        { type: "text", id: "t1", text: "answer" },
        { type: "reasoning", id: "r1", text: "thinking" },
      ],
      "answer",
    );
    expect(extractMessageSubtasks(message)).toEqual([]);
  });

  it("extracts a single running subtask", () => {
    const message = assistantMessage([
      {
        type: "subtask",
        id: "s1",
        agent: "research",
        description: "find the bug",
        prompt: "where is the null deref?",
        status: "running",
      },
    ]);
    expect(extractMessageSubtasks(message)).toEqual([
      {
        id: "s1",
        agent: "research",
        description: "find the bug",
        prompt: "where is the null deref?",
        status: "running",
      },
    ]);
  });

  it("keeps each subtask separate (does not join, unlike reasoning)", () => {
    const message = assistantMessage([
      { type: "subtask", id: "s1", agent: "research", status: "completed" },
      { type: "subtask", id: "s2", agent: "writer", status: "running" },
    ]);
    const result = extractMessageSubtasks(message);
    expect(result).toHaveLength(2);
    expect(result[0].agent).toBe("research");
    expect(result[1].agent).toBe("writer");
  });

  it("carries output and error through to the extracted shape", () => {
    const message = assistantMessage([
      {
        type: "subtask",
        id: "s1",
        agent: "research",
        status: "failed",
        output: "partial result",
        error: "boom",
      },
    ]);
    expect(extractMessageSubtasks(message)).toEqual([
      {
        id: "s1",
        agent: "research",
        status: "failed",
        output: "partial result",
        error: "boom",
      },
    ]);
  });

  it("falls back to a synthesized id when the part has no id", () => {
    const message = assistantMessage([
      { type: "subtask", agent: "research", status: "running" },
    ]);
    expect(extractMessageSubtasks(message)).toEqual([
      { id: "msg-1:subtask:0", agent: "research", status: "running" },
    ]);
  });

  it("synthesized fallback id uses the part's position, not the part's own id", () => {
    const message = assistantMessage([
      { type: "text", id: "t1", text: "preamble" },
      { type: "subtask", agent: "research", status: "running" },
    ]);
    expect(extractMessageSubtasks(message)[0].id).toBe("msg-1:subtask:1");
  });

  it("drops subtasks whose agent is whitespace-only", () => {
    const message = assistantMessage([
      { type: "subtask", id: "s1", agent: "   ", status: "running" },
      { type: "subtask", id: "s2", agent: "real", status: "running" },
    ]);
    expect(extractMessageSubtasks(message)).toEqual([
      { id: "s2", agent: "real", status: "running" },
    ]);
  });

  it("keeps a subtask with an agent name but no description/output", () => {
    const message = assistantMessage([
      { type: "subtask", id: "s1", agent: "research", status: "running" },
    ]);
    expect(extractMessageSubtasks(message)).toHaveLength(1);
  });

  it("does not gate on role — role filtering is the component's concern (mirrors reasoning)", () => {
    const userMessage: ChatMessage = {
      id: "u1",
      role: "user",
      content: "hi",
      createdAt: "2026-06-16T00:00:00.000Z",
      parts: [{ type: "subtask", id: "s1", agent: "research", status: "running" }],
    };
    expect(extractMessageSubtasks(userMessage)).toEqual([
      { id: "s1", agent: "research", status: "running" },
    ]);
  });

  it("omits optional fields that are undefined on the part", () => {
    const message = assistantMessage([
      {
        type: "subtask",
        id: "s1",
        agent: "research",
        status: "completed",
      },
    ]);
    const [subtask] = extractMessageSubtasks(message);
    expect(subtask).toEqual({ id: "s1", agent: "research", status: "completed" });
    expect("description" in subtask).toBe(false);
    expect("prompt" in subtask).toBe(false);
    expect("output" in subtask).toBe(false);
    expect("error" in subtask).toBe(false);
  });
});
