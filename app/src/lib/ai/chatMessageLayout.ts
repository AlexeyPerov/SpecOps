import type {
  ChatDiffPart,
  ChatFilePart,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatSubtaskPart,
  ChatSubtaskStatus,
} from "../domain/contracts";
import type { MessageStepBoundary } from "./chatSteps";

/**
 * Ordered, interleaved render plan for a single message (M12-T1).
 *
 * Historically `ChatMessageList.svelte` derived each part kind via per-type
 * extractors and rendered them in a *fixed block order* (steps → reasoning →
 * subtasks → content → images → files → diffs). The underlying `message.parts`
 * array preserves arrival order, but the renderer flattened by type, so any
 * interleaving (e.g. two text segments around a reasoning block) was lost.
 *
 * This module walks `message.parts` once, in stored order, and emits one slot
 * per renderable part. The component iterates the slots and dispatches each to
 * its existing renderer (`ReasoningBlock` / `SubtaskCard` / `StepSeparator` /
 * `MarkdownRenderer` / `ImageAttachment` / `FileAttachmentChip` / `InlineDiff`).
 * Tool cards (`message.toolCalls`) and the per-message totals footer
 * (`extractMessageStepTotals`) stay outside the slot loop — they are not parts.
 *
 * Validation mirrors the per-type extractors (`chatReasoning` / `chatSubtasks` /
 * `chatSteps` / `chatAttachments` / `chatDiffs`) so the same parts are dropped:
 * whitespace-only reasoning, subtasks with empty agent names, file parts with
 * empty url/mime, diff parts with neither a snapshot nor files. `cost` parts
 * carry no UI (they feed `extractMessageStepTotals`) and are skipped here.
 *
 * Step parts arrive as `start` / `finish` pairs; we collapse each pair into a
 * single `step-boundary` slot positioned at the *finish* part (where the step
 * completes and the next content chunk begins). An open `start` with no
 * matching finish (a step still in flight) emits its boundary at the start
 * position. This preserves the "separator between content chunks" intent while
 * keeping each step's separator anchored to its real position in the stream.
 */
export type MessageRenderSlot =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; id: string; text: string }
  | { kind: "subtask"; key: string; subtask: RenderSubtask }
  | { kind: "step-boundary"; key: string; boundary: MessageStepBoundary }
  | { kind: "file-image"; key: string; attachment: RenderAttachment }
  | { kind: "file-other"; key: string; attachment: RenderAttachment }
  | { kind: "diff"; key: string; diff: RenderDiff };

/**
 * Subtask shape for rendering — a slimmed `ChatSubtaskPart` with a guaranteed
 * stable id (synthesized when the wire part omits one). Mirrors `MessageSubtask`
 * from `chatSubtasks.ts`; duplicated locally so the layout module stays
 * self-contained and the slot type is a plain serializable value.
 */
export interface RenderSubtask {
  id: string;
  agent: string;
  description?: string;
  prompt?: string;
  status: ChatSubtaskStatus;
  output?: string;
  error?: string;
}

/** File attachment shape for rendering, with a stable id + image classification. */
export interface RenderAttachment {
  id: string;
  mime: string;
  filename?: string;
  url: string;
  isImage: boolean;
}

/** Diff/snapshot shape for rendering, with a stable id. */
export interface RenderDiff {
  id: string;
  snapshot?: string;
  files?: string[];
}

const IMAGE_MIME_PREFIX = "image/";
// SVG is `image/svg+xml` but rendered inline (safe as an <img> source here).
const IMAGE_MIME_WHITELIST = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/avif",
]);

function isImageMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  if (IMAGE_MIME_WHITELIST.has(normalized)) {
    return true;
  }
  // Unknown image/* subtypes are treated as images too; the renderer degrades
  // gracefully if the browser can't decode them.
  return normalized.startsWith(IMAGE_MIME_PREFIX);
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

function isFilePart(part: ChatMessagePart): part is ChatFilePart {
  return part.type === "file";
}

function isDiffPart(part: ChatMessagePart): part is ChatDiffPart {
  return part.type === "diff";
}

function resolveStepIndex(part: ChatStepPart, arrival: number): number {
  if (typeof part.index === "number" && Number.isFinite(part.index) && part.index >= 0) {
    return part.index;
  }
  return arrival;
}

function makeBoundaryId(messageId: string, index: number, partId: string | undefined): string {
  if (partId && partId.length > 0) {
    return partId;
  }
  return `${messageId}:step:${index}`;
}

/**
 * Builds the ordered render plan for a message's parts. Returns an empty array
 * when the message has no parts or no renderable parts (after validation). The
 * caller renders `message.content` separately when there are no `text` slots
 * (the live-streaming case, where text lives on `message.content` rather than
 * in `parts[]`).
 *
 * Step boundaries are positioned by arrival (anchored to their finish / open
 * start position), NOT sorted by step number — interleaving requires position
 * fidelity. `extractMessageSteps` (used for the totals footer) still sorts by
 * step number; the two views are independent.
 */
export function buildMessageRenderSlots(message: ChatMessage): MessageRenderSlot[] {
  const parts = message.parts;
  if (!parts || parts.length === 0) {
    return [];
  }

  // Pass 1 — pair step starts/finishes into boundaries and record the part
  // index each boundary should anchor to (the finish index for completed/failed
  // steps; the start index for steps still in flight). `pendingByIndex` holds
  // open starts keyed by resolved step index; the value records the start's
  // part index so a running boundary can anchor there.
  const boundaryAtPartIndex = new Map<number, MessageStepBoundary>();
  const pendingByIndex = new Map<number, { startPartIndex: number; startPart: ChatStepPart }>();
  let stepArrival = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!isStepPart(part)) {
      continue;
    }
    const arrival = stepArrival;
    stepArrival += 1;
    const index = resolveStepIndex(part, arrival);
    if (part.phase === "start") {
      // Replace any earlier open start for the same index (re-emitted start).
      pendingByIndex.set(index, { startPartIndex: i, startPart: part });
      continue;
    }
    // phase === "finish"
    const open = pendingByIndex.get(index);
    pendingByIndex.delete(index);
    const startPart = open?.startPart ?? null;
    const idPart = part.id ? part : startPart;
    const hasTokens = Boolean(part.tokens);
    boundaryAtPartIndex.set(i, {
      id: makeBoundaryId(message.id, index, idPart?.id),
      stepNumber: index + 1,
      status: hasTokens ? "completed" : "failed",
      ...(part.cost !== undefined ? { cost: part.cost } : {}),
      ...(part.tokens ? { tokens: part.tokens } : {}),
      ...(part.reason ? { reason: part.reason } : {}),
    });
  }
  // Any starts still open are steps in flight — anchor their running boundary
  // at the start's part index (the position where the step began).
  for (const { startPartIndex, startPart } of pendingByIndex.values()) {
    const arrival = stepArrival;
    stepArrival += 1;
    const index = resolveStepIndex(startPart, arrival);
    boundaryAtPartIndex.set(startPartIndex, {
      id: makeBoundaryId(message.id, index, startPart.id),
      stepNumber: index + 1,
      status: "running",
    });
  }

  // Pass 2 — walk parts in stored order, emitting one slot per renderable part.
  // A step-boundary slot is emitted at its anchor part index (and the raw
  // start/finish parts themselves emit nothing). Counters synthesize stable
  // keys for id-less parts (matches the per-type extractors'
  // `${messageId}:<kind>:<index>` fallback ids).
  const slots: MessageRenderSlot[] = [];
  let reasoningIndex = 0;
  let subtaskIndex = 0;
  let fileIndex = 0;
  let diffIndex = 0;
  let textIndex = 0;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const boundary = boundaryAtPartIndex.get(i);
    if (boundary) {
      slots.push({ kind: "step-boundary", key: boundary.id, boundary });
    }
    if (isStepPart(part)) {
      // Step start/finish parts are represented by the boundary slot above;
      // the raw parts emit nothing on their own.
      continue;
    }
    if (isReasoningPart(part)) {
      const text = part.text.trim();
      if (text.length === 0) {
        continue;
      }
      const id =
        part.id && part.id.length > 0 ? part.id : `${message.id}:reasoning:${reasoningIndex}`;
      reasoningIndex += 1;
      slots.push({ kind: "reasoning", key: id, id, text });
      continue;
    }
    if (isSubtaskPart(part)) {
      const agent = part.agent.trim();
      if (agent.length === 0) {
        continue;
      }
      const id = part.id && part.id.length > 0 ? part.id : `${message.id}:subtask:${subtaskIndex}`;
      subtaskIndex += 1;
      const subtask: RenderSubtask = {
        id,
        agent,
        ...(part.description ? { description: part.description } : {}),
        ...(part.prompt ? { prompt: part.prompt } : {}),
        status: part.status,
        ...(part.output ? { output: part.output } : {}),
        ...(part.error ? { error: part.error } : {}),
      };
      slots.push({ kind: "subtask", key: id, subtask });
      continue;
    }
    if (part.type === "text") {
      const key = part.id && part.id.length > 0 ? part.id : `${message.id}:text:${textIndex}`;
      textIndex += 1;
      slots.push({ kind: "text", key, text: part.text });
      continue;
    }
    if (isFilePart(part)) {
      const url = part.url.trim();
      const mime = part.mime.trim();
      if (url.length === 0 || mime.length === 0) {
        continue;
      }
      const id = part.id && part.id.length > 0 ? part.id : `${message.id}:file:${fileIndex}`;
      fileIndex += 1;
      const attachment: RenderAttachment = {
        id,
        mime,
        ...(part.filename && part.filename.trim().length > 0
          ? { filename: part.filename.trim() }
          : {}),
        url,
        isImage: isImageMime(mime),
      };
      slots.push({
        kind: attachment.isImage ? "file-image" : "file-other",
        key: id,
        attachment,
      });
      continue;
    }
    if (isDiffPart(part)) {
      const snapshot = part.snapshot?.trim();
      const files = part.files
        ?.map((file) => file.trim())
        .filter((file) => file.length > 0);
      if ((!snapshot || snapshot.length === 0) && (!files || files.length === 0)) {
        continue;
      }
      const id = part.id && part.id.length > 0 ? part.id : `${message.id}:diff:${diffIndex}`;
      diffIndex += 1;
      const diff: RenderDiff = {
        id,
        ...(snapshot && snapshot.length > 0 ? { snapshot } : {}),
        ...(files && files.length > 0 ? { files } : {}),
      };
      slots.push({ kind: "diff", key: id, diff });
      continue;
    }
    // cost parts carry no UI (consumed by extractMessageStepTotals); skip.
  }

  return slots;
}
