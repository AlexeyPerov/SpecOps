/**
 * Fold phase-B {@link SessionEvent}s into the live assistant-message model
 * (phase F, task AS01-F-03).
 *
 * The host delivers turn events as runtime-neutral `SessionEvent`s; the existing
 * chat UI renders `ChatMessage` content + structured `parts` + `toolCalls`. This
 * reducer bridges the two by adapting each event into the already-proven
 * `chatStreamParts` / `toolCallReducer` accumulators, so the live streaming
 * render path is identical whether a turn comes from the fake runtime (phase F)
 * or a future real adapter (phases 02–05) — the common UI only ever sees
 * `SessionEvent`.
 */

import type { ChatMessagePart, ChatTokenUsage, ToolCallRecord } from "../../domain/contracts";
import type { SessionEvent } from "../events";
import {
  applyReasoningDelta,
  applyReasoningEnded,
  applyStepFailed,
  applyStepFinished,
  applyStepStarted,
  applySubtaskStarted,
} from "../../ai/chatStreamParts";
import { applyToolCompleted, applyToolProgress, applyToolStarted } from "../../ai/toolCallReducer";

export interface TurnFoldState {
  content: string;
  parts: ChatMessagePart[];
  toolCalls: ToolCallRecord[];
}

export function initialTurnFoldState(): TurnFoldState {
  return { content: "", parts: [], toolCalls: [] };
}

function toUsage(tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }): ChatTokenUsage {
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { read: tokens.cache.read, write: tokens.cache.write },
  };
}

/**
 * Fold one event into `state`. Returns the next state (immutable updates per
 * slice, so callers can detect which slice changed by reference equality). Events
 * that do not affect content/parts/toolCalls (permissions, questions, status,
 * terminals, diagnostics) are passed through unchanged — the pipeline owns those.
 */
export function foldSessionEvent(state: TurnFoldState, event: SessionEvent): TurnFoldState {
  switch (event.type) {
    case "text.delta":
      return { ...state, content: state.content + event.delta };
    case "text.finished":
      return { ...state, content: event.text };

    case "reasoning.delta":
      return {
        ...state,
        parts: applyReasoningDelta(state.parts, { reasoningId: event.reasoningId, delta: event.delta }),
      };
    case "reasoning.ended":
      return {
        ...state,
        parts: applyReasoningEnded(state.parts, { reasoningId: event.reasoningId, text: event.text }),
      };

    case "subtask.started":
      return {
        ...state,
        parts: applySubtaskStarted(state.parts, {
          subtaskId: event.subtask.id,
          agent: event.subtask.agent,
          description: event.subtask.description ?? null,
          prompt: event.subtask.prompt ?? null,
        }),
      };

    case "step.started":
      return {
        ...state,
        parts: applyStepStarted(state.parts, {
          stepId: event.step.id,
          agent: null,
          modelId: null,
          providerId: null,
        }),
      };
    case "step.finished":
      return {
        ...state,
        parts: applyStepFinished(state.parts, {
          stepId: event.step.id,
          reason: event.step.reason ?? null,
          cost: event.step.cost ?? 0,
          tokens: event.step.tokens ? toUsage(event.step.tokens) : {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      };
    case "step.failed":
      return {
        ...state,
        parts: applyStepFailed(state.parts, {
          stepId: event.step.id,
          message: event.step.reason ?? "Step failed",
        }),
      };

    case "tool.started":
      return {
        ...state,
        toolCalls: applyToolStarted(state.toolCalls, {
          toolName: event.toolCall.toolName,
          callId: event.toolCall.callId,
          input: event.toolCall.input,
        }),
      };
    case "tool.progress":
      return {
        ...state,
        toolCalls: applyToolProgress(state.toolCalls, {
          toolName: "",
          callId: event.callId,
          output: event.progress,
        }),
      };
    case "tool.completed":
      return {
        ...state,
        toolCalls: applyToolCompleted(state.toolCalls, {
          toolName: "",
          callId: event.callId,
          output: event.output,
          isError: event.status === "failure",
        }),
      };

    case "usage.recorded":
      return {
        ...state,
        parts: [
          ...state.parts,
          {
            type: "cost",
            cost: event.cost ?? 0,
            ...(event.usage
              ? { tokens: toUsage(event.usage) }
              : {}),
          },
        ],
      };

    case "diff.posted":
      return {
        ...state,
        parts: [
          ...state.parts,
          {
            type: "diff",
            ...(event.diff.snapshot ? { snapshot: event.diff.snapshot } : {}),
            ...(event.diff.files ? { files: [...event.diff.files] } : {}),
          },
        ],
      };

    // content/parts/toolCalls are unaffected by these; the pipeline handles them.
    case "turn.started":
    case "turn.finished":
    case "turn.failed":
    case "turn.cancelled":
    case "permission.requested":
    case "question.requested":
    case "status.changed":
    case "attachment.posted":
    case "compaction.applied":
    case "diagnostic":
      return state;
  }
}
