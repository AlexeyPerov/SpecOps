import { describe, expect, it } from "vitest";
import { countMessageDiffs, extractMessageDiffs } from "./chatDiffs";
import type { ChatMessage, ChatMessagePart } from "../domain/contracts";

function assistantMessage(parts: ChatMessagePart[], content = ""): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content,
    createdAt: "2026-06-17T00:00:00.000Z",
    parts,
  };
}

describe("extractMessageDiffs", () => {
  it("returns an empty array when the message has no parts", () => {
    expect(extractMessageDiffs(assistantMessage([], "just text"))).toEqual([]);
  });

  it("returns an empty array when parts has no diff part", () => {
    const message = assistantMessage(
      [
        { type: "text", id: "t1", text: "answer" },
        { type: "reasoning", id: "r1", text: "thinking" },
      ],
      "answer",
    );
    expect(extractMessageDiffs(message)).toEqual([]);
  });

  it("extracts a snapshot-only diff (OpenCode snapshot part)", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", snapshot: "abc123" },
    ]);
    expect(extractMessageDiffs(message)).toEqual([
      { id: "d1", snapshot: "abc123" },
    ]);
  });

  it("extracts a files-only diff (OpenCode patch part with no hash)", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", files: ["src/a.ts", "src/b.ts"] },
    ]);
    expect(extractMessageDiffs(message)).toEqual([
      { id: "d1", files: ["src/a.ts", "src/b.ts"] },
    ]);
  });

  it("extracts a diff carrying both snapshot hash and changed files", () => {
    const message = assistantMessage([
      {
        type: "diff",
        id: "d1",
        snapshot: "abc123",
        files: ["src/a.ts", "src/b.ts"],
      },
    ]);
    expect(extractMessageDiffs(message)).toEqual([
      { id: "d1", snapshot: "abc123", files: ["src/a.ts", "src/b.ts"] },
    ]);
  });

  it("keeps each diff part separate (does not join, unlike reasoning)", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", snapshot: "abc123" },
      { type: "diff", id: "d2", snapshot: "def456" },
    ]);
    const result = extractMessageDiffs(message);
    expect(result).toHaveLength(2);
    expect(result[0].snapshot).toBe("abc123");
    expect(result[1].snapshot).toBe("def456");
  });

  it("falls back to a synthesized id when the part has no id", () => {
    const message = assistantMessage([{ type: "diff", snapshot: "abc123" }]);
    expect(extractMessageDiffs(message)).toEqual([
      { id: "msg-1:diff:0", snapshot: "abc123" },
    ]);
  });

  it("synthesized fallback id uses the part's position among all parts", () => {
    const message = assistantMessage([
      { type: "text", id: "t1", text: "preamble" },
      { type: "diff", snapshot: "abc123" },
    ]);
    expect(extractMessageDiffs(message)[0].id).toBe("msg-1:diff:1");
  });

  it("drops a diff part that carries neither a snapshot hash nor files", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1" },
      { type: "diff", id: "d2", snapshot: "abc123" },
    ]);
    expect(extractMessageDiffs(message)).toEqual([
      { id: "d2", snapshot: "abc123" },
    ]);
  });

  it("drops a diff part whose snapshot and files are whitespace-only", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", snapshot: "   ", files: ["   ", ""] },
    ]);
    expect(extractMessageDiffs(message)).toEqual([]);
  });

  it("trims the snapshot hash and drops whitespace-only file entries", () => {
    const message = assistantMessage([
      {
        type: "diff",
        id: "d1",
        snapshot: "  abc123  ",
        files: ["src/a.ts", "   ", "", "src/b.ts"],
      },
    ]);
    expect(extractMessageDiffs(message)).toEqual([
      { id: "d1", snapshot: "abc123", files: ["src/a.ts", "src/b.ts"] },
    ]);
  });

  it("omits the snapshot field entirely when absent, rather than rendering empty", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", files: ["src/a.ts"] },
    ]);
    const [diff] = extractMessageDiffs(message);
    expect(diff).toEqual({ id: "d1", files: ["src/a.ts"] });
    expect("snapshot" in diff).toBe(false);
  });

  it("omits the files field entirely when absent, rather than rendering empty", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", snapshot: "abc123" },
    ]);
    const [diff] = extractMessageDiffs(message);
    expect(diff).toEqual({ id: "d1", snapshot: "abc123" });
    expect("files" in diff).toBe(false);
  });

  it("does not gate on role — role filtering is the component's concern (mirrors reasoning/subtask/step)", () => {
    const userMessage: ChatMessage = {
      id: "u1",
      role: "user",
      content: "hi",
      createdAt: "2026-06-17T00:00:00.000Z",
      parts: [{ type: "diff", id: "d1", snapshot: "abc123" }],
    };
    expect(extractMessageDiffs(userMessage)).toEqual([
      { id: "d1", snapshot: "abc123" },
    ]);
  });
});

describe("countMessageDiffs", () => {
  it("returns 0 when the message has no parts", () => {
    expect(countMessageDiffs(assistantMessage([]))).toBe(0);
  });

  it("returns 0 when no renderable diff parts are present (dropped parts don't count)", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1" },
      { type: "diff", id: "d2", snapshot: "   ", files: ["  "] },
    ]);
    expect(countMessageDiffs(message)).toBe(0);
  });

  it("returns the total count of renderable diff parts", () => {
    const message = assistantMessage([
      { type: "diff", id: "d1", snapshot: "abc123" },
      { type: "diff", id: "d2", files: ["src/a.ts"] },
      { type: "diff", id: "d3", snapshot: "def456", files: ["src/b.ts"] },
    ]);
    expect(countMessageDiffs(message)).toBe(3);
  });
});
