import { describe, expect, it } from "vitest";
import {
  applyReasoningDelta,
  applyReasoningEnded,
  applyStepFailed,
  applyStepFinished,
  applyStepStarted,
  applySubtaskStarted,
} from "./chatStreamParts";
import { extractMessageReasoning } from "./chatReasoning";
import { extractMessageSubtasks } from "./chatSubtasks";
import { extractMessageSteps } from "./chatSteps";
import type {
  ChatMessage,
  ChatMessagePart,
  ChatTokenUsage,
} from "../domain/contracts";

function messageWith(parts: ChatMessagePart[]): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content: "",
    createdAt: "2026-06-19T00:00:00.000Z",
    parts,
  };
}

function tokens(input: number, output: number, reasoning = 0): ChatTokenUsage {
  return { input, output, reasoning, cache: { read: 0, write: 0 } };
}

describe("applyReasoningDelta", () => {
  it("appends a new reasoning part when no match exists", () => {
    const parts = applyReasoningDelta([], { reasoningId: "r1", delta: "Hello" });
    expect(parts).toEqual([{ type: "reasoning", id: "r1", text: "Hello" }]);
  });

  it("merges consecutive deltas into the matching part by reasoningId", () => {
    let parts = applyReasoningDelta([], { reasoningId: "r1", delta: "Hello " });
    parts = applyReasoningDelta(parts, { reasoningId: "r1", delta: "world" });
    expect(parts).toEqual([{ type: "reasoning", id: "r1", text: "Hello world" }]);
  });

  it("keeps separate parts for distinct reasoning ids", () => {
    let parts = applyReasoningDelta([], { reasoningId: "r1", delta: "first" });
    parts = applyReasoningDelta(parts, { reasoningId: "r2", delta: "second" });
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ id: "r1", text: "first" });
    expect(parts[1]).toMatchObject({ id: "r2", text: "second" });
  });

  it("folds id-less deltas into the first id-less reasoning part", () => {
    let parts = applyReasoningDelta([], { reasoningId: null, delta: "alpha " });
    parts = applyReasoningDelta(parts, { reasoningId: null, delta: "beta" });
    expect(parts).toEqual([{ type: "reasoning", text: "alpha beta" }]);
  });

  it("returns the parts unchanged for an empty delta (no churn)", () => {
    const before: ChatMessagePart[] = [{ type: "reasoning", id: "r1", text: "x" }];
    expect(applyReasoningDelta(before, { reasoningId: "r1", delta: "" })).toBe(before);
  });
});

describe("applyReasoningEnded", () => {
  it("finalizes the matching part with the authoritative text", () => {
    let parts = applyReasoningDelta([], { reasoningId: "r1", delta: "partial" });
    parts = applyReasoningEnded(parts, { reasoningId: "r1", text: "partial complete" });
    expect(parts).toEqual([{ type: "reasoning", id: "r1", text: "partial complete" }]);
  });

  it("creates a part when ended arrives without a preceding delta", () => {
    const parts = applyReasoningEnded([], { reasoningId: "r1", text: "standalone" });
    expect(parts).toEqual([{ type: "reasoning", id: "r1", text: "standalone" }]);
  });

  it("matches id-less ended against the first id-less reasoning part", () => {
    let parts = applyReasoningDelta([], { reasoningId: null, delta: "x" });
    parts = applyReasoningEnded(parts, { reasoningId: null, text: "full" });
    expect(extractMessageReasoning(messageWith(parts))?.text).toBe("full");
  });
});

describe("applySubtaskStarted", () => {
  it("appends a running subtask card", () => {
    const parts = applySubtaskStarted([], {
      subtaskId: "s1",
      agent: "research",
      description: "look it up",
      prompt: "find the answer",
    });
    expect(parts).toEqual([
      {
        type: "subtask",
        id: "s1",
        agent: "research",
        description: "look it up",
        prompt: "find the answer",
        status: "running",
      },
    ]);
    expect(extractMessageSubtasks(messageWith(parts))[0].status).toBe("running");
  });

  it("upserts by subtaskId (latest replaces in place)", () => {
    let parts = applySubtaskStarted([], {
      subtaskId: "s1",
      agent: "research",
      description: null,
      prompt: null,
    });
    parts = applySubtaskStarted(parts, {
      subtaskId: "s1",
      agent: "research",
      description: "updated",
      prompt: null,
    });
    expect(extractMessageSubtasks(messageWith(parts))).toHaveLength(1);
    expect(extractMessageSubtasks(messageWith(parts))[0].description).toBe("updated");
  });

  it("appends distinct subtasks for null ids", () => {
    let parts = applySubtaskStarted([], {
      subtaskId: null,
      agent: "a",
      description: null,
      prompt: null,
    });
    parts = applySubtaskStarted(parts, {
      subtaskId: null,
      agent: "b",
      description: null,
      prompt: null,
    });
    expect(extractMessageSubtasks(messageWith(parts))).toHaveLength(2);
  });

  it("omits description/prompt when null", () => {
    const parts = applySubtaskStarted([], {
      subtaskId: "s1",
      agent: "x",
      description: null,
      prompt: null,
    });
    expect(parts[0]).not.toHaveProperty("description");
    expect(parts[0]).not.toHaveProperty("prompt");
  });
});

describe("applyStepStarted", () => {
  it("appends a step-start part with a synthesized 0-based index", () => {
    const parts = applyStepStarted([], {
      stepId: "st0",
      agent: "build",
      modelId: "m",
      providerId: "p",
    });
    expect(parts).toEqual([{ type: "step", phase: "start", index: 0, id: "st0" }]);
  });

  it("increments the index for the second step", () => {
    let parts = applyStepStarted([], {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepStarted(parts, {
      stepId: "st1",
      agent: null,
      modelId: null,
      providerId: null,
    });
    expect(parts[1]).toMatchObject({ phase: "start", index: 1, id: "st1" });
  });

  it("is idempotent for a re-emitted start with the same stepId", () => {
    const event = {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    };
    let parts = applyStepStarted([], event);
    const before = parts;
    parts = applyStepStarted(parts, event);
    expect(parts).toBe(before);
    expect(parts).toHaveLength(1);
  });
});

describe("applyStepFinished", () => {
  it("pairs a finish with its start by stepId, sharing the index", () => {
    let parts = applyStepStarted([], {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepFinished(parts, {
      stepId: "st0",
      reason: "stop",
      cost: 0.01,
      tokens: tokens(100, 200),
    });
    const [boundary] = extractMessageSteps(messageWith(parts));
    expect(boundary).toEqual({
      id: "st0",
      stepNumber: 1,
      status: "completed",
      cost: 0.01,
      tokens: tokens(100, 200),
      reason: "stop",
    });
  });

  it("keeps multiple steps ordered by index", () => {
    let parts = applyStepStarted([], {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepFinished(parts, {
      stepId: "st0",
      reason: "stop",
      cost: 0.01,
      tokens: tokens(1, 2),
    });
    parts = applyStepStarted(parts, {
      stepId: "st1",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepFinished(parts, {
      stepId: "st1",
      reason: "stop",
      cost: 0.02,
      tokens: tokens(3, 4),
    });
    const boundaries = extractMessageSteps(messageWith(parts));
    expect(boundaries.map((b) => b.stepNumber)).toEqual([1, 2]);
    expect(boundaries.map((b) => b.cost)).toEqual([0.01, 0.02]);
  });

  it("finishes an orphan start via null stepId by matching the open start", () => {
    let parts = applyStepStarted([], {
      stepId: null,
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepFinished(parts, {
      stepId: null,
      reason: "stop",
      cost: 0.01,
      tokens: tokens(1, 2),
    });
    const [boundary] = extractMessageSteps(messageWith(parts));
    expect(boundary.stepNumber).toBe(1);
    expect(boundary.status).toBe("completed");
  });
});

describe("applyStepFailed", () => {
  it("emits a token-less finish so the extractor surfaces status failed", () => {
    let parts = applyStepStarted([], {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepFailed(parts, { stepId: "st0", message: "boom" });
    const [boundary] = extractMessageSteps(messageWith(parts));
    expect(boundary.status).toBe("failed");
    expect(boundary.reason).toBe("boom");
    expect(boundary.stepNumber).toBe(1);
  });

  it("does not include a tokens payload on the emitted finish part", () => {
    let parts = applyStepStarted([], {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyStepFailed(parts, { stepId: "st0", message: "boom" });
    const finish = parts[parts.length - 1];
    expect(finish).toMatchObject({ type: "step", phase: "finish" });
    expect(finish).not.toHaveProperty("tokens");
  });
});

describe("ordering invariant (live vs hydrated shapes)", () => {
  it("renders reasoning, subtask, and step parts in arrival order", () => {
    let parts = applyStepStarted([], {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    });
    parts = applyReasoningDelta(parts, { reasoningId: "r1", delta: "thinking" });
    parts = applySubtaskStarted(parts, {
      subtaskId: "s1",
      agent: "research",
      description: null,
      prompt: null,
    });
    parts = applyStepFinished(parts, {
      stepId: "st0",
      reason: "stop",
      cost: 0.01,
      tokens: tokens(1, 2),
    });
    // Each extractor pulls its kind independently — order in the array only
    // needs to be stable across live + hydrated views.
    expect(extractMessageReasoning(messageWith(parts))?.text).toBe("thinking");
    expect(extractMessageSubtasks(messageWith(parts))).toHaveLength(1);
    expect(extractMessageSteps(messageWith(parts))).toHaveLength(1);
  });
});

describe("idempotent flush (parts array stability)", () => {
  it("returns the same array reference when nothing changes", () => {
    const seeded = applyReasoningDelta([], { reasoningId: "r1", delta: "x" });
    // Re-applying a no-op delta returns the same reference.
    expect(applyReasoningDelta(seeded, { reasoningId: "r1", delta: "" })).toBe(seeded);
    // Re-emitting a known step start is a no-op.
    const start = {
      stepId: "st0",
      agent: null,
      modelId: null,
      providerId: null,
    };
    const withStart = applyStepStarted(seeded, start);
    expect(applyStepStarted(withStart, start)).toBe(withStart);
  });
});
