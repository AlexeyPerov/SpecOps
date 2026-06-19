import { describe, expect, it } from "vitest";
import {
  extractMessageStepTotals,
  extractMessageSteps,
  extractSessionTotals,
} from "./chatSteps";
import { formatCost } from "./chatTokenFormat";
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

function assistantMessageWithId(id: string, parts: ChatMessagePart[]): ChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    createdAt: "2026-06-16T00:00:00.000Z",
    parts,
  };
}

function userMessage(id: string, content = ""): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-06-16T00:00:00.000Z" };
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

  it("prefers a trailing cost part as the canonical message total (no double-count)", () => {
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
      { type: "cost", cost: 0.05, tokens: tokens(150, 250) } satisfies ChatCostPart,
    ]);
    // The trailing `cost` part is OpenCode's cumulative `info.cost` /
    // `info.tokens` — i.e. the sum of all step finishes already. Using it
    // directly avoids double-counting the step finish against the total.
    const totals = extractMessageStepTotals(message);
    expect(totals?.tokens).toEqual(tokens(150, 250));
    expect(totals?.cost).toBeCloseTo(0.05, 10);
  });

  it("prefers the LAST cost part when several are present", () => {
    // OpenCode appends a fresh cumulative cost part on each session-messages
    // refresh; the latest is the most up-to-date canonical total.
    const message = assistantMessage([
      { type: "cost", cost: 0.05, tokens: tokens(150, 250) } satisfies ChatCostPart,
      { type: "cost", cost: 0.09, tokens: tokens(300, 500) } satisfies ChatCostPart,
    ]);
    expect(extractMessageStepTotals(message)).toEqual({
      cost: 0.09,
      tokens: tokens(300, 500),
    });
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

  // M12-T4 — the formatCost ambiguity (zero cost vs missing cost both render
  // "$0.00") is resolved by the null guard, not by the formatter. These tests
  // pin the invariant end-to-end: a missing-cost message yields null totals so
  // the per-message footer renders nothing, while a genuine zero-cost message
  // (free / fully-cached model that still carried a token payload) yields
  // non-null totals so the footer renders and shows "$0.00" via formatCost.
  it("M12-T4: a message whose parts carry no cost data returns null (renders no footer)", () => {
    // Only text + reasoning — no step finishes and no cost part. The footer
    // gate (`{#if stepTotals}` in ChatMessageList) renders nothing here, so a
    // missing-cost message is never shown as "$0.00".
    const message = assistantMessage([
      { type: "text", id: "t1", text: "answer" },
      { type: "reasoning", id: "r1", text: "thinking" },
    ]);
    expect(extractMessageStepTotals(message)).toBeNull();
  });

  it("M12-T4: a genuine zero-cost message (free/cached model with a token payload) renders $0.00", () => {
    // A canonical cost part with cost: 0 but a real token payload is a genuine
    // zero cost (free / fully-cached model), not a missing one. The extractor
    // returns non-null so the footer renders, and formatCost renders "$0.00".
    const message = assistantMessage([
      stepStart(0, "s0"),
      stepFinish(0, 0, tokens(100, 200)),
      { type: "cost", cost: 0, tokens: tokens(100, 200) } satisfies ChatCostPart,
    ]);
    const totals = extractMessageStepTotals(message);
    expect(totals).not.toBeNull();
    expect(totals?.cost).toBe(0);
    expect(totals?.tokens).toEqual(tokens(100, 200));
    // The formatter is what the footer calls — pin the rendered string so the
    // "genuine zero" path stays distinct from "missing" (which renders nothing).
    expect(formatCost(totals!.cost)).toBe("$0.00");
  });

  it("M12-T4: a cost part with neither cost nor tokens (truly empty) returns null", () => {
    // A canonical cost part carrying no payload at all is treated as missing
    // (cost === 0 && tokens === undefined → null), so it renders no footer
    // rather than a misleading "$0.00".
    const message = assistantMessage([
      { type: "cost", cost: 0 } satisfies ChatCostPart,
    ]);
    expect(extractMessageStepTotals(message)).toBeNull();
  });
});

describe("extractSessionTotals", () => {
  it("returns null for an empty message list", () => {
    expect(extractSessionTotals([])).toBeNull();
  });

  it("returns null when no message contributes (no parts)", () => {
    expect(extractSessionTotals([userMessage("u1", "hi")])).toBeNull();
  });

  it("returns null when only user messages are present", () => {
    expect(
      extractSessionTotals([
        userMessage("u1", "hi"),
        assistantMessageWithId("a1", []),
      ]),
    ).toBeNull();
  });

  it("sums a single assistant message's totals", () => {
    const message = assistantMessageWithId("a1", [
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
    ]);
    expect(extractSessionTotals([userMessage("u1", "hi"), message])).toEqual({
      cost: 0.01,
      tokens: tokens(100, 200),
      messageCount: 1,
    });
  });

  it("sums cost and tokens across multiple assistant messages", () => {
    const a1 = assistantMessageWithId("a1", [
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
    ]);
    const a2 = assistantMessageWithId("a2", [
      stepStart(0, "s0"),
      stepFinish(0, 0.02, tokens(300, 400)),
    ]);
    expect(extractSessionTotals([userMessage("u1"), a1, userMessage("u2"), a2])).toEqual({
      cost: 0.03,
      tokens: tokens(400, 600),
      messageCount: 2,
    });
  });

  it("does not double-count a message's cost part against its step finishes", () => {
    // a1 carries both a step finish AND a trailing cumulative cost part — the
    // per-message extractor already prefers the canonical cost part, so the
    // session total reflects only 0.05 / (150, 250), not the sum.
    const a1 = assistantMessageWithId("a1", [
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
      { type: "cost", cost: 0.05, tokens: tokens(150, 250) } satisfies ChatCostPart,
    ]);
    expect(extractSessionTotals([a1])).toEqual({
      cost: 0.05,
      tokens: tokens(150, 250),
      messageCount: 1,
    });
  });

  it("sums cache read / write fields across messages", () => {
    const a1 = assistantMessageWithId("a1", [
      {
        type: "step",
        phase: "finish",
        index: 0,
        id: "s0",
        cost: 0.01,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
      },
    ]);
    const a2 = assistantMessageWithId("a2", [
      {
        type: "step",
        phase: "finish",
        index: 0,
        id: "s0",
        cost: 0.02,
        tokens: { input: 10, output: 20, reasoning: 30, cache: { read: 40, write: 50 } },
      },
    ]);
    expect(extractSessionTotals([a1, a2])?.tokens).toEqual({
      input: 11,
      output: 22,
      reasoning: 33,
      cache: { read: 44, write: 55 },
    });
  });

  it("skips assistant messages with no contributing parts but counts the rest", () => {
    const a1 = assistantMessageWithId("a1", [
      { type: "text", id: "t1", text: "answer" },
    ]);
    const a2 = assistantMessageWithId("a2", [
      stepStart(0, "s0"),
      stepFinish(0, 0.01, tokens(100, 200)),
    ]);
    expect(extractSessionTotals([a1, a2])).toEqual({
      cost: 0.01,
      tokens: tokens(100, 200),
      messageCount: 1,
    });
  });
});
