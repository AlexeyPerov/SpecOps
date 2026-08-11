import { describe, expect, it } from "vitest";
import {
  appendUserTurn,
  applySessionEvent,
  emptyTranscript,
  replaySessionEvents,
} from "./transcript";
import { asNativeSessionId, asSpecOpsTurnId, mintSpecOpsTurnId, resetSessionIdCountersForTests } from "./ids";
import type { SessionEvent } from "./events";

const NATIVE = asNativeSessionId("native-1");
const AT = "2026-01-01T00:00:00.000Z";

type DistributiveOmit<T, K extends string | number | symbol> = T extends unknown ? Omit<T, K> : never;
type EventSeed = DistributiveOmit<SessionEvent, "nativeSessionId" | "seq" | "at">;

function event(seq: number, partial: EventSeed): SessionEvent {
  return { nativeSessionId: NATIVE, seq, at: AT, ...partial } as SessionEvent;
}

describe("transcript reducer", () => {
  it("ignores events that target no active assistant turn (no crash, no partial turn)", () => {
    resetSessionIdCountersForTests();
    const transcript = emptyTranscript();
    const next = applySessionEvent(
      transcript,
      event(1, { type: "text.delta", turnId: asSpecOpsTurnId("sos-turn-99"), delta: "oops" }),
    );
    expect(next.turns).toEqual([]);
  });

  it("accumulates text, reasoning, tools, structured parts, usage, then completes the turn", () => {
    resetSessionIdCountersForTests();
    const userTurnId = mintSpecOpsTurnId();
    let transcript = appendUserTurn(emptyTranscript(), { id: userTurnId, content: "do it", at: AT });

    const assistantTurnId = mintSpecOpsTurnId();
    const events: SessionEvent[] = [
      event(1, { type: "turn.started", turnId: assistantTurnId }),
      event(2, { type: "text.delta", turnId: assistantTurnId, delta: "Hello " }),
      event(3, { type: "text.delta", turnId: assistantTurnId, delta: "world" }),
      event(4, { type: "reasoning.delta", turnId: assistantTurnId, reasoningId: "r1", delta: "thin" }),
      event(5, { type: "reasoning.delta", turnId: assistantTurnId, reasoningId: "r1", delta: "king" }),
      event(6, { type: "reasoning.ended", turnId: assistantTurnId, reasoningId: "r1", text: "thinking" }),
      event(7, { type: "tool.started", turnId: assistantTurnId, toolCall: { callId: "t1", toolName: "edit", status: "pending" } }),
      event(8, { type: "tool.progress", turnId: assistantTurnId, callId: "t1", progress: { done: 1 } }),
      event(9, { type: "tool.completed", turnId: assistantTurnId, callId: "t1", status: "success", output: "ok" }),
      event(10, { type: "subtask.started", turnId: assistantTurnId, subtask: { id: "s1", agent: "plan", status: "running" } }),
      event(11, { type: "step.started", turnId: assistantTurnId, step: { id: "st1", phase: "started" } }),
      event(12, { type: "step.finished", turnId: assistantTurnId, step: { id: "st1", phase: "finished" } }),
      event(13, { type: "attachment.posted", turnId: assistantTurnId, attachment: { id: "a1", mime: "image/png", url: "/f.png" } }),
      event(14, { type: "diff.posted", turnId: assistantTurnId, diff: { id: "d1", files: ["/a.ts"] } }),
      event(15, { type: "usage.recorded", turnId: assistantTurnId, usage: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } }, cost: 0.01 }),
      event(16, { type: "turn.finished", turnId: assistantTurnId }),
    ];
    transcript = replaySessionEvents(events, transcript);

    expect(transcript.turns).toHaveLength(2);
    const assistant = transcript.turns[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("Hello world");
    expect(assistant.reasoning).toEqual([{ id: "r1", text: "thinking" }]);
    expect(assistant.toolCalls).toEqual([
      { callId: "t1", toolName: "edit", status: "success", output: "ok", progress: { done: 1 } },
    ]);
    expect(assistant.parts.map((part) => part.kind)).toEqual(["subtask", "step", "attachment", "diff", "cost"]);
    expect(assistant.usage).toEqual({ input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } });
    expect(assistant.cost).toBe(0.01);
    expect(assistant.status).toBe("completed");
  });

  it("marks a turn failed and keeps partial content", () => {
    resetSessionIdCountersForTests();
    const turnId = mintSpecOpsTurnId();
    let transcript = replaySessionEvents(
      [
        event(1, { type: "turn.started", turnId }),
        event(2, { type: "text.delta", turnId, delta: "partial" }),
        event(3, { type: "turn.failed", turnId, message: "boom" }),
      ],
      emptyTranscript(),
    );
    const turn = transcript.turns[0];
    expect(turn.content).toBe("partial");
    expect(turn.status).toBe("failed");
  });

  it("records compaction and appends diagnostics", () => {
    resetSessionIdCountersForTests();
    const transcript = replaySessionEvents(
      [
        event(1, { type: "compaction.applied", removedMessageCount: 4 }),
        event(2, { type: "compaction.applied", removedMessageCount: 6 }),
        event(3, { type: "diagnostic", level: "info", message: "hi", reason: "unknown-native" }),
      ],
      emptyTranscript(),
    );
    expect(transcript.compaction).toEqual({ count: 2, lastAt: AT, removedMessageCount: 10 });
    expect(transcript.diagnostics).toHaveLength(1);
    expect(transcript.diagnostics[0].message).toBe("hi");
  });

  it("replay is deterministic: the same event stream reproduces the same transcript", () => {
    resetSessionIdCountersForTests();
    const turnId = mintSpecOpsTurnId();
    const events: SessionEvent[] = [
      event(1, { type: "turn.started", turnId }),
      event(2, { type: "text.delta", turnId, delta: "a" }),
      event(3, { type: "turn.finished", turnId }),
    ];
    const first = replaySessionEvents(events, emptyTranscript());
    resetSessionIdCountersForTests();
    const second = replaySessionEvents(events, emptyTranscript());
    expect(second).toEqual(first);
  });
});
