import { describe, expect, it } from "vitest";
import { extractMessageStepTotals, extractMessageSteps } from "./chatSteps";
import type {
  ChatCostPart,
  ChatMessage,
  ChatMessagePart,
  ChatStepPart,
  ChatTokenUsage,
} from "../domain/contracts";

function assistantMessage(parts: ChatMessagePart[], content = ""): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content,
    createdAt: "2026-06-16T00:00:00.000Z",
    parts,
  };
}

function tokens(input: number, output: number, reasoning = 0): ChatTokenUsage {
  return {
    input,
    output,
    reasoning,
    cache: { read: 0, write: 0 },
  };
}

function stepStart(index: number, id?: string): ChatStepPart {
  return { type: "step", phase: "start", index, ...(id ? { id } : {}) };
}

function stepFinish(
  index: number,
  cost: number,
  tokenUsage: ChatTokenUsage,
  reason = "stop",
  id?: string,
): ChatStepPart {
  return {
    type: "step",
    phase: "finish",
    index,
    cost,
    tokens: tokenUsage,
    reason,
    ...(id ? { id } : {}),
  };
}

describe("extractMessageSteps", () => {
  it("returns an empty array when the message has no parts", () => {
    expect(extractMessageSteps(assistantMessage([], "just text"))).toEqual([]);
  });

  it("returns an empty array when parts has no step part", () => {
    const message = assistantMessage(
      [
        { type: "text", id: "t1", text: "answer" },
        { type: "reasoning", id: "r1", text: "thinking" },
      ],
      "answer",
    );
    expect(extractMessageSteps(message)).toEqual([]);
  });

  it("pairs a start + finish into a single completed boundary", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepFinish(0, 0.012, tokens(100, 200), "stop", "s0"),
    ]);
    expect(extractMessageSteps(message)).toEqual([
      {
        id: "s0",
        stepNumber: 1,
        status: "completed",
        cost: 0.012,
        tokens: tokens(100, 200),
        reason: "stop",
      },
    ]);
  });

  it("surfaces an open start (no finish) as a running boundary", () => {
    const message = assistantMessage([stepStart(0)]);
    expect(extractMessageSteps(message)).toEqual([
      { id: "msg-1:step:0", stepNumber: 1, status: "running" },
    ]);
  });

  it("keeps multiple steps ordered by step number", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(10, 20)),
      stepStart(1, "s1"),
      stepFinish(1, 0.02, tokens(30, 40)),
    ]);
    const result = extractMessageSteps(message);
    expect(result).toHaveLength(2);
    expect(result[0].stepNumber).toBe(1);
    expect(result[0].cost).toBe(0.01);
    expect(result[1].stepNumber).toBe(2);
    expect(result[1].cost).toBe(0.02);
  });

  it("treats a finish with no tokens as a failed step", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      { type: "step", phase: "finish", index: 0, id: "s0", cost: 0, reason: "error" },
    ]);
    expect(extractMessageSteps(message)).toEqual([
      { id: "s0", stepNumber: 1, status: "failed", cost: 0, reason: "error" },
    ]);
  });

  it("falls back to a synthesized id when the part has no id", () => {
    const message = assistantMessage([stepStart(0), stepFinish(0, 0.01, tokens(1, 2))]);
    expect(extractMessageSteps(message)[0].id).toBe("msg-1:step:0");
  });

  it("falls back to arrival position among step parts when index is missing", () => {
    const message = assistantMessage([
      { type: "step", phase: "start" },
      { type: "step", phase: "finish", cost: 0.01, tokens: tokens(1, 2) },
    ]);
    const [boundary] = extractMessageSteps(message);
    // arrival index 0 → stepNumber 1; parts pair by the same synthesized index.
    expect(boundary.stepNumber).toBe(1);
  });

  it("replaces a re-emitted start for the same index (latest wins)", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepStart(0, "s0b"),
      stepFinish(0, 0.01, tokens(1, 2)),
    ]);
    expect(extractMessageSteps(message)).toHaveLength(1);
    expect(extractMessageSteps(message)[0].stepNumber).toBe(1);
  });

  it("orders a running step after completed steps regardless of arrival", () => {
    const message = assistantMessage([
      stepStart(0, "s0"), // first step, will finish
      stepStart(1, "s1"), // second step, still running
      stepFinish(0, 0.01, tokens(1, 2)),
    ]);
    const result = extractMessageSteps(message);
    expect(result.map((b) => b.stepNumber)).toEqual([1, 2]);
    expect(result[0].status).toBe("completed");
    expect(result[1].status).toBe("running");
  });

  it("does not gate on role — role filtering is the component's concern", () => {
    const userMessage: ChatMessage = {
      id: "u1",
      role: "user",
      content: "hi",
      createdAt: "2026-06-16T00:00:00.000Z",
      parts: [stepStart(0, "s0"), stepFinish(0, 0.01, tokens(1, 2))],
    };
    expect(extractMessageSteps(userMessage)).toHaveLength(1);
  });

  it("omits optional fields that are undefined on the finish part", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      { type: "step", phase: "finish", index: 0, id: "s0", tokens: tokens(1, 2) },
    ]);
    const [boundary] = extractMessageSteps(message);
    expect(boundary).toEqual({ id: "s0", stepNumber: 1, status: "completed", tokens: tokens(1, 2) });
    expect("cost" in boundary).toBe(false);
    expect("reason" in boundary).toBe(false);
  });
});

describe("extractMessageStepTotals", () => {
  it("returns null when the message has no parts", () => {
    expect(extractMessageStepTotals(assistantMessage([], "text"))).toBeNull();
  });

  it("returns null when no step or cost parts contribute", () => {
    const message = assistantMessage([
      { type: "text", id: "t1", text: "answer" },
      { type: "reasoning", id: "r1", text: "thinking" },
    ]);
    expect(extractMessageStepTotals(message)).toBeNull();
  });

  it("sums cost and tokens across multiple step finishes", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
      stepStart(1, "s1"),
      stepFinish(1, 0.02, tokens(300, 400)),
    ]);
    expect(extractMessageStepTotals(message)).toEqual({
      cost: 0.03,
      tokens: tokens(400, 600),
    });
  });

  it("folds in a trailing cost part (from session-messages hydration)", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
      { type: "cost", cost: 0.05, tokens: tokens(150, 250) } satisfies ChatCostPart,
    ]);
    // Step finish + cost part both contribute — totals are additive (the cost
    // part is OpenCode's cumulative info.cost; we surface the sum and the
    // footer is a presence indicator, not a de-duplicated ledger — M1-T9 owns
    // per-message canonical totals).
    const totals = extractMessageStepTotals(message);
    expect(totals?.tokens).toEqual(tokens(250, 450));
    expect(totals?.cost).toBeCloseTo(0.06, 10);
  });

  it("returns totals from a lone cost part when no step parts exist", () => {
    const message = assistantMessage([
      { type: "cost", cost: 0.04, tokens: tokens(10, 20) } satisfies ChatCostPart,
    ]);
    expect(extractMessageStepTotals(message)).toEqual({
      cost: 0.04,
      tokens: tokens(10, 20),
    });
  });

  it("ignores non-finite cost values", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      {
        type: "step",
        phase: "finish",
        index: 0,
        id: "s0",
        cost: Number.NaN,
        tokens: tokens(1, 2),
      },
    ]);
    expect(extractMessageStepTotals(message)).toEqual({
      cost: 0,
      tokens: tokens(1, 2),
    });
  });

  it("accumulates cache read / write fields", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      {
        type: "step",
        phase: "finish",
        index: 0,
        id: "s0",
        cost: 0.01,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      },
    ]);
    expect(extractMessageStepTotals(message)?.tokens).toEqual({
      input: 1,
      output: 2,
      reasoning: 3,
      cache: { read: 4, write: 5 },
    });
  });
});
