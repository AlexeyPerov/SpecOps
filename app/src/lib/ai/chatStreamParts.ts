import type {
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatSubtaskPart,
  ChatTokenUsage,
} from "../domain/contracts";

/**
 * Live-stream part accumulation (M8-T1).
 *
 * The workspace-agent stream emits `reasoning.*` / `subtask.started` / `step.*`
 * events during a turn; these helpers fold them into the active assistant
 * message's `parts` array incrementally so reasoning panels, subtask cards, and
 * step separators render *during* the turn (not only after M1-T3
 * `session.messages` hydration on tab reopen).
 *
 * Mirrors the pure `applyToolStarted` / `applyToolCompleted` style from
 * `toolCallReducer.ts`: each helper takes the current parts array plus a
 * structurally-typed event and returns the next parts array. Input types are
 * declared locally (not imported from the backend) so the module is unit-
 * testable in isolation and stays decoupled from the transport layer.
 *
 * Part shapes match `opencodeSessionMessages.ts` so the live and hydrated
 * views are visually consistent (the renderer extracts each part kind
 * independently, but identical shapes keep the persisted + reopened message
 * stable).
 */

export interface ReasoningDeltaInput {
  reasoningId: string | null;
  delta: string;
}

export interface ReasoningEndedInput {
  reasoningId: string | null;
  text: string;
}

export interface SubtaskStartedInput {
  subtaskId: string | null;
  agent: string;
  description: string | null;
  prompt: string | null;
}

export interface StepStartedInput {
  stepId: string | null;
  agent: string | null;
  modelId: string | null;
  providerId: string | null;
}

export interface StepFinishedInput {
  stepId: string | null;
  reason: string | null;
  cost: number;
  tokens: ChatTokenUsage;
}

export interface StepFailedInput {
  stepId: string | null;
  message: string;
}

function isReasoningPart(part: ChatMessagePart): part is ChatReasoningPart {
  return part.type === "reasoning";
}

function isSubtaskPart(part: ChatMessagePart): part is ChatSubtaskPart {
  return part.type === "subtask";
}

function isStepPart(part: ChatMessagePart): part is ChatStepPart {
  return part.type === "step";
}

/**
 * Appends (or merges into the matching reasoning part) a reasoning delta. When
 * `reasoningId` is present the part is matched by id; otherwise deltas fold
 * into the first reasoning part that has no id (a single default thinking
 * block). Returns the input unchanged when the delta is empty so the store
 * isn't churned for no-op frames.
 */
export function applyReasoningDelta(
  parts: ChatMessagePart[],
  event: ReasoningDeltaInput,
): ChatMessagePart[] {
  if (!event.delta) {
    return parts;
  }
  let matched = false;
  const next = parts.map((part) => {
    if (isReasoningPart(part) && reasoningMatches(part, event.reasoningId)) {
      matched = true;
      return { ...part, text: part.text + event.delta };
    }
    return part;
  });
  if (matched) {
    return next;
  }
  const created: ChatReasoningPart = {
    type: "reasoning",
    ...(event.reasoningId ? { id: event.reasoningId } : {}),
    text: event.delta,
  };
  return [...next, created];
}

/**
 * Finalizes a reasoning part with the authoritative full text carried by
 * `reasoning.ended`. If no delta preceded it (ended arrives standalone), a new
 * part is created so the panel still renders.
 */
export function applyReasoningEnded(
  parts: ChatMessagePart[],
  event: ReasoningEndedInput,
): ChatMessagePart[] {
  let matched = false;
  const next = parts.map((part) => {
    if (isReasoningPart(part) && reasoningMatches(part, event.reasoningId)) {
      matched = true;
      return { ...part, text: event.text };
    }
    return part;
  });
  if (matched) {
    return next;
  }
  const created: ChatReasoningPart = {
    type: "reasoning",
    ...(event.reasoningId ? { id: event.reasoningId } : {}),
    text: event.text,
  };
  return [...next, created];
}

function reasoningMatches(part: ChatReasoningPart, reasoningId: string | null): boolean {
  if (reasoningId) {
    return part.id === reasoningId;
  }
  // No id on the event: fold into the first id-less reasoning part.
  return part.id === undefined;
}

/**
 * Upserts a subtask part keyed by `subtaskId` with `status: "running"`. A
 * repeat `subtask.started` for the same id replaces the in-place card (matches
 * `message.part.updated` re-emissions). Events with a null id always append —
 * each is treated as a distinct sub-agent invocation.
 */
export function applySubtaskStarted(
  parts: ChatMessagePart[],
  event: SubtaskStartedInput,
): ChatMessagePart[] {
  const created: ChatSubtaskPart = {
    type: "subtask",
    ...(event.subtaskId ? { id: event.subtaskId } : {}),
    agent: event.agent,
    ...(event.description ? { description: event.description } : {}),
    ...(event.prompt ? { prompt: event.prompt } : {}),
    status: "running",
  };
  if (event.subtaskId) {
    let matched = false;
    const next = parts.map((part) => {
      if (isSubtaskPart(part) && part.id === event.subtaskId) {
        matched = true;
        return created;
      }
      return part;
    });
    if (matched) {
      return next;
    }
  }
  return [...parts, created];
}

/**
 * Appends a step-start part. The synthesized `index` is the count of existing
 * step-start parts — this lines up with `opencodeSessionMessages`, where a
 * step's start and finish share the same 0-based index (incremented once per
 * completed step). Re-emitted starts for a known `stepId` are idempotent.
 */
export function applyStepStarted(
  parts: ChatMessagePart[],
  event: StepStartedInput,
): ChatMessagePart[] {
  if (event.stepId) {
    const exists = parts.some(
      (part) => isStepPart(part) && part.phase === "start" && part.id === event.stepId,
    );
    if (exists) {
      return parts;
    }
  }
  const index = countStepStarts(parts);
  const part: ChatStepPart = {
    type: "step",
    phase: "start",
    index,
    ...(event.stepId ? { id: event.stepId } : {}),
  };
  return [...parts, part];
}

/**
 * Appends the matching step-finish part (cost / tokens / reason). The index is
 * resolved from the paired start — by `stepId` when present, otherwise the most
 * recent open start (a start index with no finish yet).
 */
export function applyStepFinished(
  parts: ChatMessagePart[],
  event: StepFinishedInput,
): ChatMessagePart[] {
  const index = resolveStepFinishIndex(parts, event.stepId);
  const part: ChatStepPart = {
    type: "step",
    phase: "finish",
    ...(index !== null ? { index } : {}),
    cost: event.cost,
    tokens: event.tokens,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.stepId ? { id: event.stepId } : {}),
  };
  return [...parts, part];
}

/**
 * Appends a step-finish part with NO token payload so `extractMessageSteps`
 * surfaces it as `status: "failed"` (a finish without tokens is the failed-step
 * signal shared with `opencodeSessionMessages`). The error message is carried
 * as the finish `reason`.
 */
export function applyStepFailed(
  parts: ChatMessagePart[],
  event: StepFailedInput,
): ChatMessagePart[] {
  const index = resolveStepFinishIndex(parts, event.stepId);
  const part: ChatStepPart = {
    type: "step",
    phase: "finish",
    ...(index !== null ? { index } : {}),
    reason: event.message,
    ...(event.stepId ? { id: event.stepId } : {}),
  };
  return [...parts, part];
}

function countStepStarts(parts: ChatMessagePart[]): number {
  let count = 0;
  for (const part of parts) {
    if (isStepPart(part) && part.phase === "start") {
      count += 1;
    }
  }
  return count;
}

function resolveStepFinishIndex(
  parts: ChatMessagePart[],
  stepId: string | null,
): number | null {
  if (stepId) {
    for (const part of parts) {
      if (isStepPart(part) && part.phase === "start" && part.id === stepId) {
        return part.index ?? null;
      }
    }
  }
  return findOpenStepIndex(parts);
}

/**
 * Most recent step-start index that has no matching finish yet (defensive
 * against orphan finishes / null stepIds). Returns null when every start is
 * already finished (or there are none), in which case the caller appends an
 * index-less finish that the extractor treats as its own boundary.
 */
function findOpenStepIndex(parts: ChatMessagePart[]): number | null {
  const starts = new Set<number>();
  const finished = new Set<number>();
  for (const part of parts) {
    if (!isStepPart(part)) {
      continue;
    }
    if (typeof part.index !== "number") {
      continue;
    }
    if (part.phase === "start") {
      starts.add(part.index);
    } else {
      finished.add(part.index);
    }
  }
  let open: number | null = null;
  for (const index of starts) {
    if (!finished.has(index) && (open === null || index > open)) {
      open = index;
    }
  }
  return open;
}
