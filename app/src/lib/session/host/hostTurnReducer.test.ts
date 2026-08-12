import { describe, expect, it } from "vitest";
import { foldSessionEvent, initialTurnFoldState } from "./hostTurnReducer";
import type { SessionEvent } from "../events";
import type { NativeSessionId, SpecOpsTurnId } from "../ids";

const sid = "fake-native-1" as NativeSessionId;
const tid = "sos-turn-1" as SpecOpsTurnId;

function ev(partial: Omit<SessionEvent, "nativeSessionId" | "seq" | "at"> & {
  nativeSessionId?: NativeSessionId;
  seq?: number;
  at?: string;
}): SessionEvent {
  return {
    nativeSessionId: sid,
    seq: 1,
    at: "1970-01-01T00:00:00.000Z",
    ...partial,
  } as SessionEvent;
}

describe("hostTurnReducer", () => {
  it("accumulates text deltas and finalizes on text.finished", () => {
    let state = initialTurnFoldState();
    state = foldSessionEvent(state, ev({ type: "text.delta", turnId: tid, delta: "hello " }));
    state = foldSessionEvent(state, ev({ type: "text.delta", turnId: tid, delta: "world" }));
    expect(state.content).toBe("hello world");
    state = foldSessionEvent(state, ev({ type: "text.finished", turnId: tid, text: "hello world!" }));
    expect(state.content).toBe("hello world!");
  });

  it("folds reasoning deltas then finalizes with reasoning.ended", () => {
    let state = initialTurnFoldState();
    state = foldSessionEvent(state, ev({ type: "reasoning.delta", turnId: tid, reasoningId: "r1", delta: "thin" }));
    state = foldSessionEvent(state, ev({ type: "reasoning.delta", turnId: tid, reasoningId: "r1", delta: "king" }));
    state = foldSessionEvent(state, ev({ type: "reasoning.ended", turnId: tid, reasoningId: "r1", text: "thinking" }));
    expect(state.parts).toHaveLength(1);
    expect(state.parts[0]).toMatchObject({ type: "reasoning", id: "r1", text: "thinking" });
  });

  it("maps tool.started → completed with success/failure status", () => {
    let state = initialTurnFoldState();
    state = foldSessionEvent(
      state,
      ev({
        type: "tool.started",
        turnId: tid,
        toolCall: { callId: "c1", toolName: "edit", status: "running", input: { x: 1 } },
      }),
    );
    expect(state.toolCalls[0]).toMatchObject({ callId: "c1", toolName: "edit", status: "pending" });
    state = foldSessionEvent(
      state,
      ev({ type: "tool.completed", turnId: tid, callId: "c1", status: "success", output: "ok" }),
    );
    expect(state.toolCalls[0].status).toBe("success");
  });

  it("appends a cost part from usage.recorded", () => {
    let state = initialTurnFoldState();
    state = foldSessionEvent(
      state,
      ev({
        type: "usage.recorded",
        turnId: tid,
        usage: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 3 } },
        cost: 0.01,
      }),
    );
    expect(state.parts).toHaveLength(1);
    expect(state.parts[0]).toMatchObject({ type: "cost", cost: 0.01 });
  });

  it("leaves content/parts/toolCalls untouched for terminal + control events", () => {
    const before = initialTurnFoldState();
    for (const event of [
      ev({ type: "turn.started", turnId: tid }),
      ev({ type: "permission.requested", turnId: tid, request: { permissionId: "p", label: "l" } }),
      ev({ type: "question.requested", turnId: tid, request: { questionId: "q", prompt: "?" } }),
      ev({ type: "status.changed", status: "running" }),
      ev({ type: "turn.finished", turnId: tid }),
    ]) {
      expect(foldSessionEvent(before, event)).toBe(before);
    }
  });
});
