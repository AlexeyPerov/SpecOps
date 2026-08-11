/**
 * Cached session transcript + event-replay reducer (phase B domain).
 *
 * The transcript is the persisted, runtime-neutral rendering source. Adapters
 * emit {@link SessionEvent}s; {@link applySessionEvent} folds them into a
 * {@link SessionTranscript} deterministically, so a replayed event stream
 * reproduces the same transcript (foundational for restart recovery in
 * phase E and the fake-runtime E2E in phase F).
 */

import type {
  AttachmentSnapshot,
  DiffSnapshot,
  ReasoningEntry,
  SessionEvent,
  StepSnapshot,
  SubtaskSnapshot,
  ToolCallSnapshot,
  ToolCallStatus,
  UsageSnapshot,
} from "./events";
import type { SpecOpsTurnId } from "./ids";
import { asSpecOpsTurnId } from "./ids";

export type TurnStatus = "running" | "completed" | "failed" | "cancelled";

export type SessionTurnPart =
  | { readonly kind: "subtask"; readonly subtask: SubtaskSnapshot }
  | { readonly kind: "step"; readonly step: StepSnapshot }
  | { readonly kind: "attachment"; readonly attachment: AttachmentSnapshot }
  | { readonly kind: "diff"; readonly diff: DiffSnapshot }
  | { readonly kind: "cost"; readonly cost: number; readonly usage?: UsageSnapshot };

export interface SessionTurn {
  readonly id: SpecOpsTurnId;
  readonly role: "user" | "assistant";
  content: string;
  reasoning: ReasoningEntry[];
  toolCalls: ToolCallSnapshot[];
  parts: SessionTurnPart[];
  usage?: UsageSnapshot;
  cost?: number;
  readonly startedAt: string;
  finishedAt?: string;
  status: TurnStatus;
}

export interface SessionCompaction {
  count: number;
  lastAt: string;
  removedMessageCount: number;
}

export type DiagnosticEvent = Extract<SessionEvent, { type: "diagnostic" }>;

export interface SessionTranscript {
  turns: SessionTurn[];
  compaction?: SessionCompaction;
  diagnostics: DiagnosticEvent[];
}

export function emptyTranscript(): SessionTranscript {
  return { turns: [], diagnostics: [] };
}

export function appendUserTurn(
  transcript: SessionTranscript,
  input: { id: SpecOpsTurnId; content: string; at: string },
): SessionTranscript {
  const turn: SessionTurn = {
    id: input.id,
    role: "user",
    content: input.content,
    reasoning: [],
    toolCalls: [],
    parts: [],
    startedAt: input.at,
    status: "completed",
  };
  return { ...transcript, turns: [...transcript.turns, turn] };
}

function cloneTurn(turn: SessionTurn): SessionTurn {
  return {
    ...turn,
    reasoning: [...turn.reasoning],
    toolCalls: turn.toolCalls.map((toolCall) => ({ ...toolCall })),
    parts: [...turn.parts],
  };
}

function findAssistantTurn(
  transcript: SessionTranscript,
  turnId: SpecOpsTurnId,
): { index: number; turn: SessionTurn } | null {
  for (let index = transcript.turns.length - 1; index >= 0; index -= 1) {
    const turn = transcript.turns[index];
    if (turn.id === turnId && turn.role === "assistant") {
      return { index, turn: cloneTurn(turn) };
    }
  }
  return null;
}

function withTurn(
  transcript: SessionTranscript,
  index: number,
  mutate: (turn: SessionTurn) => SessionTurn,
): SessionTranscript {
  const turns = [...transcript.turns];
  turns[index] = mutate(cloneTurn(turns[index]));
  return { ...transcript, turns };
}

function applyReasoningDelta(
  reasoning: ReasoningEntry[],
  reasoningId: string,
  delta: string,
): ReasoningEntry[] {
  const next = reasoning.map((entry) => ({ ...entry }));
  const existingIndex = next.findIndex((entry) => entry.id === reasoningId);
  if (existingIndex >= 0) {
    next[existingIndex] = { id: reasoningId, text: next[existingIndex].text + delta };
  } else {
    next.push({ id: reasoningId, text: delta });
  }
  return next;
}

function applyToolStatus(
  toolCalls: ToolCallSnapshot[],
  callId: string,
  status: ToolCallStatus,
  output?: unknown,
): ToolCallSnapshot[] {
  const next = toolCalls.map((toolCall) => ({ ...toolCall }));
  const existingIndex = next.findIndex((toolCall) => toolCall.callId === callId);
  if (existingIndex >= 0) {
    next[existingIndex] = {
      ...next[existingIndex],
      status,
      ...(output !== undefined ? { output } : {}),
    };
  } else {
    next.push({ callId, toolName: callId, status, ...(output !== undefined ? { output } : {}) });
  }
  return next;
}

function applyToolProgress(
  toolCalls: ToolCallSnapshot[],
  callId: string,
  progress: unknown,
): ToolCallSnapshot[] {
  const next = toolCalls.map((toolCall) => ({ ...toolCall }));
  const existingIndex = next.findIndex((toolCall) => toolCall.callId === callId);
  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], progress };
  } else {
    next.push({ callId, toolName: callId, status: "running", progress });
  }
  return next;
}

/**
 * Fold one normalized event into the transcript. Pure and total: an event
 * whose `turnId` does not match an active assistant turn (or a transient
 * event with no transcript effect, e.g. permission/question) leaves the
 * transcript unchanged. Diagnostic events are appended to `diagnostics`.
 */
export function applySessionEvent(transcript: SessionTranscript, event: SessionEvent): SessionTranscript {
  if (event.type === "diagnostic") {
    return { ...transcript, diagnostics: [...transcript.diagnostics, event] };
  }
  if (event.type === "compaction.applied") {
    const previous = transcript.compaction;
    const removedMessageCount = (previous?.removedMessageCount ?? 0) + event.removedMessageCount;
    return {
      ...transcript,
      compaction: {
        count: (previous?.count ?? 0) + 1,
        lastAt: event.at,
        removedMessageCount,
      },
    };
  }
  // Transient events with no cached-transcript effect.
  if (
    event.type === "permission.requested" ||
    event.type === "question.requested" ||
    event.type === "status.changed"
  ) {
    return transcript;
  }

  if (event.type === "turn.started") {
    const turn: SessionTurn = {
      id: event.turnId,
      role: "assistant",
      content: "",
      reasoning: [],
      toolCalls: [],
      parts: [],
      startedAt: event.at,
      status: "running",
    };
    return { ...transcript, turns: [...transcript.turns, turn] };
  }

  const found = findAssistantTurn(transcript, event.turnId);
  if (!found) {
    return transcript;
  }
  const { index, turn } = found;

  switch (event.type) {
    case "text.delta":
      return withTurn(transcript, index, (t) => ({ ...t, content: t.content + event.delta }));
    case "text.finished":
      return withTurn(transcript, index, (t) => ({ ...t, content: event.text }));
    case "reasoning.delta":
      return withTurn(transcript, index, (t) => ({
        ...t,
        reasoning: applyReasoningDelta(t.reasoning, event.reasoningId, event.delta),
      }));
    case "reasoning.ended": {
      return withTurn(transcript, index, (t) => {
        const withoutEntry = t.reasoning.filter((entry) => entry.id !== event.reasoningId);
        withoutEntry.push({ id: event.reasoningId, text: event.text });
        return { ...t, reasoning: withoutEntry };
      });
    }
    case "tool.started":
      return withTurn(transcript, index, (t) => ({
        ...t,
        toolCalls: [...t.toolCalls.filter((toolCall) => toolCall.callId !== event.toolCall.callId), { ...event.toolCall }],
      }));
    case "tool.progress":
      return withTurn(transcript, index, (t) => ({
        ...t,
        toolCalls: applyToolProgress(t.toolCalls, event.callId, event.progress),
      }));
    case "tool.completed":
      return withTurn(transcript, index, (t) => ({
        ...t,
        toolCalls: applyToolStatus(t.toolCalls, event.callId, event.status, event.output),
      }));
    case "subtask.started":
      return withTurn(transcript, index, (t) => ({
        ...t,
        parts: [...t.parts.filter((part) => !(part.kind === "subtask" && part.subtask.id === event.subtask.id)), { kind: "subtask", subtask: event.subtask }],
      }));
    case "step.started":
    case "step.finished":
    case "step.failed":
      return withTurn(transcript, index, (t) => ({
        ...t,
        parts: [...t.parts.filter((part) => !(part.kind === "step" && part.step.id === event.step.id)), { kind: "step", step: event.step }],
      }));
    case "attachment.posted":
      return withTurn(transcript, index, (t) => ({
        ...t,
        parts: [...t.parts.filter((part) => !(part.kind === "attachment" && part.attachment.id === event.attachment.id)), { kind: "attachment", attachment: event.attachment }],
      }));
    case "diff.posted":
      return withTurn(transcript, index, (t) => ({
        ...t,
        parts: [...t.parts.filter((part) => !(part.kind === "diff" && part.diff.id === event.diff.id)), { kind: "diff", diff: event.diff }],
      }));
    case "usage.recorded":
      return withTurn(transcript, index, (t) => ({
        ...t,
        parts: [...t.parts.filter((part) => part.kind !== "cost"), { kind: "cost", cost: event.cost ?? 0, usage: event.usage }],
        usage: event.usage,
        ...(event.cost !== undefined ? { cost: event.cost } : {}),
      }));
    case "turn.finished":
      return withTurn(transcript, index, (t) => ({ ...t, status: "completed", finishedAt: event.at }));
    case "turn.failed":
      return withTurn(transcript, index, (t) => ({ ...t, status: "failed", finishedAt: event.at }));
    case "turn.cancelled":
      return withTurn(transcript, index, (t) => ({ ...t, status: "cancelled", finishedAt: event.at }));
    default: {
      // Exhaustiveness guard: if a new event kind is added without a case,
      // this assert fails to compile (under `as never`) rather than silently
      // dropping the event.
      const _exhaustive: never = event;
      void _exhaustive;
      return transcript;
    }
  }
}

/** Apply a sequence of events; useful for replay/restart recovery. */
export function replaySessionEvents(
  events: readonly SessionEvent[],
  seed: SessionTranscript = emptyTranscript(),
): SessionTranscript {
  let transcript = seed;
  for (const event of events) {
    transcript = applySessionEvent(transcript, event);
  }
  return transcript;
}

/** Wrap a persisted/external turn id after validation. */
export function asTurnId(raw: string): SpecOpsTurnId {
  return asSpecOpsTurnId(raw);
}
