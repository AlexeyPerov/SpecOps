import { describe, expect, it } from "vitest";
import { buildMessageRenderSlots } from "./chatMessageLayout";
import type { ChatMessage, ChatMessagePart, ChatTokenUsage } from "../domain/contracts";

function message(parts: ChatMessagePart[], overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    createdAt: "2026-06-19T00:00:00.000Z",
    parts,
    ...overrides,
  };
}

function tokens(input: number, output: number): ChatTokenUsage {
  return { input, output, reasoning: 0, cache: { read: 0, write: 0 } };
}

function slotKinds(slots: ReturnType<typeof buildMessageRenderSlots>): string[] {
  return slots.map((slot) => slot.kind);
}

describe("buildMessageRenderSlots", () => {
  it("returns an empty array when the message has no parts", () => {
    expect(buildMessageRenderSlots(message(undefined as unknown as never[]))).toEqual([]);
    expect(buildMessageRenderSlots(message([]))).toEqual([]);
  });

  it("emits one text slot per text part, in arrival order", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "text", id: "t1", text: "first" },
        { type: "text", id: "t2", text: "second" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["text", "text"]);
    expect((slots[0] as { text: string }).text).toBe("first");
    expect((slots[1] as { text: string }).text).toBe("second");
  });

  it("interleaves text and reasoning in stored order (the M12-T1 fix)", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "text", id: "t1", text: "before" },
        { type: "reasoning", id: "r1", text: "thinking" },
        { type: "text", id: "t2", text: "after" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["text", "reasoning", "text"]);
    expect((slots[0] as { text: string }).text).toBe("before");
    expect((slots[2] as { text: string }).text).toBe("after");
  });

  it("drops whitespace-only reasoning parts (matches chatReasoning)", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "reasoning", id: "r1", text: "   " },
        { type: "text", id: "t1", text: "kept" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["text"]);
  });

  it("emits each reasoning part as its own slot (no joining)", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "reasoning", id: "r1", text: "one" },
        { type: "reasoning", id: "r2", text: "two" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["reasoning", "reasoning"]);
    expect((slots[0] as { id: string }).id).toBe("r1");
    expect((slots[1] as { id: string }).id).toBe("r2");
  });

  it("synthesizes a stable id for id-less reasoning/text/subtask/file/diff parts", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "reasoning", text: "no id" },
        { type: "text", text: "no id" },
      ]),
    );
    expect((slots[0] as { id: string }).id).toBe("msg-1:reasoning:0");
    expect((slots[0] as { key: string }).key).toBe("msg-1:reasoning:0");
    expect((slots[1] as { key: string }).key).toBe("msg-1:text:0");
  });

  it("emits a subtask slot per valid subtask and drops empty-agent ones", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "subtask", id: "s1", agent: "explore", status: "completed", output: "ok" },
        { type: "subtask", agent: "   ", status: "running" },
        { type: "subtask", id: "s2", agent: "build", status: "failed", error: "boom" },
      ]),
    );
    const subtaskSlots = slots.filter((slot) => slot.kind === "subtask");
    expect(subtaskSlots).toHaveLength(2);
    expect((subtaskSlots[0] as { subtask: { agent: string } }).subtask.agent).toBe("explore");
    expect((subtaskSlots[1] as { subtask: { agent: string } }).subtask.agent).toBe("build");
    expect((subtaskSlots[1] as { subtask: { error?: string } }).subtask.error).toBe("boom");
  });

  it("emits a step-boundary slot at the finish part's position", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "text", id: "t1", text: "before step" },
        { type: "step", id: "s0", phase: "start", index: 0 },
        { type: "text", id: "t2", text: "during step" },
        { type: "step", id: "s0", phase: "finish", index: 0, cost: 0.01, tokens: tokens(1, 2) },
        { type: "text", id: "t3", text: "after step" },
      ]),
    );
    // The boundary anchors at the finish part's index (3). The "during step"
    // text (index 2, between start and finish) therefore renders *before* the
    // boundary — the separator marks where the step ended, not where it began.
    expect(slotKinds(slots)).toEqual(["text", "text", "step-boundary", "text"]);
    const boundary = slots.find((slot) => slot.kind === "step-boundary") as
      | { boundary: { status: string; stepNumber: number; cost?: number } }
      | undefined;
    expect(boundary?.boundary.status).toBe("completed");
    expect(boundary?.boundary.stepNumber).toBe(1);
    expect(boundary?.boundary.cost).toBe(0.01);
  });

  it("anchors an open (running) step at its start part's position", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "text", id: "t1", text: "intro" },
        { type: "step", id: "s0", phase: "start", index: 0 },
        { type: "text", id: "t2", text: "wip" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["text", "step-boundary", "text"]);
    const boundary = slots.find((slot) => slot.kind === "step-boundary") as
      | { boundary: { status: string } }
      | undefined;
    expect(boundary?.boundary.status).toBe("running");
  });

  it("treats a finish with no tokens as a failed step boundary", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "step", id: "s0", phase: "start", index: 0 },
        { type: "step", id: "s0", phase: "finish", index: 0, cost: 0, reason: "error" },
      ]),
    );
    const boundary = slots.find((slot) => slot.kind === "step-boundary") as
      | { boundary: { status: string; reason?: string } }
      | undefined;
    expect(boundary?.boundary.status).toBe("failed");
    expect(boundary?.boundary.reason).toBe("error");
  });

  it("emits multiple step boundaries at their real positions, not sorted by number", () => {
    // Deliberately out-of-order indices to confirm we keep arrival position.
    const slots = buildMessageRenderSlots(
      message([
        { type: "step", phase: "start", index: 1 },
        { type: "step", phase: "finish", index: 1, cost: 0.02, tokens: tokens(3, 4) },
        { type: "text", id: "t1", text: "middle" },
        { type: "step", phase: "start", index: 0 },
        { type: "step", phase: "finish", index: 0, cost: 0.01, tokens: tokens(1, 2) },
      ]),
    );
    // Order should reflect arrival: step1 boundary, text, step0 boundary.
    const kinds = slotKinds(slots);
    expect(kinds).toEqual(["step-boundary", "text", "step-boundary"]);
    const boundaries = slots.filter((slot) => slot.kind === "step-boundary") as Array<{
      boundary: { stepNumber: number };
    }>;
    expect(boundaries[0].boundary.stepNumber).toBe(2);
    expect(boundaries[1].boundary.stepNumber).toBe(1);
  });

  it("classifies file parts into file-image and file-other slots", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "file", id: "f1", mime: "image/png", url: "u1" },
        { type: "file", id: "f2", mime: "application/pdf", url: "u2" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["file-image", "file-other"]);
    expect(
      (slots.find((slot) => slot.kind === "file-image") as { attachment: { isImage: boolean } })
        .attachment.isImage,
    ).toBe(true);
  });

  it("drops file parts with empty url or mime (matches chatAttachments)", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "file", mime: "image/png", url: "   " },
        { type: "file", mime: "  ", url: "ok" },
        { type: "file", id: "f1", mime: "image/png", url: "ok" },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["file-image"]);
  });

  it("emits a diff slot per valid diff and drops empty ones (matches chatDiffs)", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "diff", id: "d1", snapshot: "abc123" },
        { type: "diff", id: "d2", files: ["a.ts", "  ", "b.ts"] },
        { type: "diff", snapshot: "   ", files: [] },
      ]),
    );
    const diffSlots = slots.filter((slot) => slot.kind === "diff");
    expect(diffSlots).toHaveLength(2);
    expect((diffSlots[0] as { diff: { snapshot?: string } }).diff.snapshot).toBe("abc123");
    expect((diffSlots[1] as { diff: { files?: string[] } }).diff.files).toEqual(["a.ts", "b.ts"]);
  });

  it("skips cost parts entirely (they feed the totals footer, not the body)", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "text", id: "t1", text: "answer" },
        { type: "cost", cost: 0.05, tokens: tokens(10, 20) },
      ]),
    );
    expect(slotKinds(slots)).toEqual(["text"]);
  });

  it("interleaves all part kinds in stored order", () => {
    const slots = buildMessageRenderSlots(
      message([
        { type: "reasoning", id: "r1", text: "plan" },
        { type: "text", id: "t1", text: "step 1" },
        { type: "step", phase: "start", index: 0 },
        { type: "subtask", id: "s1", agent: "explore", status: "completed" },
        { type: "step", phase: "finish", index: 0, cost: 0.01, tokens: tokens(1, 2) },
        { type: "file", id: "f1", mime: "image/png", url: "u1" },
        { type: "text", id: "t2", text: "done" },
        { type: "diff", id: "d1", files: ["a.ts"] },
        { type: "cost", cost: 0.02, tokens: tokens(3, 4) },
      ]),
    );
    // Subtask sits between start and finish; boundary anchors at the finish.
    expect(slotKinds(slots)).toEqual([
      "reasoning",
      "text",
      "subtask",
      "step-boundary",
      "file-image",
      "text",
      "diff",
    ]);
  });
});
