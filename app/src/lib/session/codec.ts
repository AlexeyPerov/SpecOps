/**
 * Deterministic codecs for the runtime-neutral session store (phase B).
 *
 * Encoding is canonical (recursively key-sorted JSON, 2-space indent) and
 * secret-redacted, so the same record always produces byte-identical output
 * and never persists credentials. Decoding validates the envelope strictly:
 * any structural violation returns `{ ok: false, reason }` — there is no
 * silent partial decode. Callers reset explicitly on failure (no legacy
 * compatibility shims).
 */

import {
  rehydrateSessionRef,
  isSessionLifecycleStatus,
  type AgentSessionRef,
} from "./binding";
import {
  asNativeSessionId,
  asSpecOpsSessionId,
  type NativeSessionId,
  type SpecOpsSessionId,
} from "./ids";
import { isAgentRuntimeId } from "./runtime";
import { normalizeCapabilities } from "./capabilities";
import {
  SESSION_RECORD_VERSION,
  SESSION_STORE_INDEX_VERSION,
  type SessionRecord,
  type SessionStoreIndex,
  type SessionStoreIndexEntry,
} from "./record";
import {
  redactForSerialization,
} from "./redact";
import {
  emptyTranscript,
  asTurnId,
  type DiagnosticEvent,
  type SessionTurn,
  type SessionTurnPart,
  type TurnStatus,
} from "./transcript";
import type {
  ReasoningEntry,
  ToolCallSnapshot,
  ToolCallStatus,
  SessionEvent,
} from "./events";

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function decodeFailure(reason: string): DecodeResult<never> {
  return { ok: false, reason };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = readNumber(value);
  return parsed === null ? undefined : parsed;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Canonical (stable) JSON encoding
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isObject(value)) {
    const sortedKeys = Object.keys(value).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(redactForSerialization(value)), null, 2);
}

// ---------------------------------------------------------------------------
// Transcript decode
// ---------------------------------------------------------------------------

const TOOL_CALL_STATUSES: readonly ToolCallStatus[] = ["pending", "running", "success", "failure"];
const TURN_STATUSES: readonly TurnStatus[] = ["running", "completed", "failed", "cancelled"];

function decodeReasoning(value: unknown, path: string): ReasoningEntry[] | null {
  const arr = readArray(value);
  if (!arr) {
    return null;
  }
  const out: ReasoningEntry[] = [];
  for (const entry of arr) {
    if (!isObject(entry)) {
      return null;
    }
    const id = readString(entry.id);
    const text = readString(entry.text);
    if (id === null || text === null) {
      return null;
    }
    out.push({ id, text });
  }
  void path;
  return out;
}

function decodeToolCalls(value: unknown): ToolCallSnapshot[] | null {
  const arr = readArray(value);
  if (!arr) {
    return null;
  }
  const out: ToolCallSnapshot[] = [];
  for (const entry of arr) {
    if (!isObject(entry)) {
      return null;
    }
    const callId = readString(entry.callId);
    const toolName = readString(entry.toolName);
    const status = readString(entry.status);
    if (callId === null || toolName === null || status === null || !TOOL_CALL_STATUSES.includes(status as ToolCallStatus)) {
      return null;
    }
    out.push({
      callId,
      toolName,
      status: status as ToolCallStatus,
      ...(entry.input !== undefined ? { input: entry.input } : {}),
      ...(entry.output !== undefined ? { output: entry.output } : {}),
      ...(entry.progress !== undefined ? { progress: entry.progress } : {}),
    });
  }
  return out;
}

function decodePart(value: unknown): SessionTurnPart | null {
  if (!isObject(value)) {
    return null;
  }
  const kind = readString(value.kind);
  if (kind === null) {
    return null;
  }
  if (kind === "subtask") {
    const subtask = value.subtask;
    if (!isObject(subtask)) {
      return null;
    }
    const id = readString(subtask.id);
    const agent = readString(subtask.agent);
    const status = readString(subtask.status);
    if (id === null || agent === null || status === null || !["running", "completed", "failed"].includes(status)) {
      return null;
    }
    return {
      kind: "subtask",
      subtask: {
        id,
        agent,
        status: status as "running" | "completed" | "failed",
        ...(subtask.description !== undefined ? { description: readOptionalString(subtask.description) } : {}),
        ...(subtask.prompt !== undefined ? { prompt: readOptionalString(subtask.prompt) } : {}),
        ...(subtask.output !== undefined ? { output: readOptionalString(subtask.output) } : {}),
        ...(subtask.error !== undefined ? { error: readOptionalString(subtask.error) } : {}),
      },
    };
  }
  if (kind === "step") {
    const step = value.step;
    if (!isObject(step)) {
      return null;
    }
    const id = readString(step.id);
    const phase = readString(step.phase);
    if (id === null || phase === null || !["started", "finished", "failed"].includes(phase)) {
      return null;
    }
    return {
      kind: "step",
      step: {
        id,
        phase: phase as "started" | "finished" | "failed",
        ...(step.index !== undefined ? { index: readOptionalNumber(step.index) } : {}),
        ...(step.reason !== undefined ? { reason: readOptionalString(step.reason) } : {}),
        ...(step.cost !== undefined ? { cost: readOptionalNumber(step.cost) } : {}),
      },
    };
  }
  if (kind === "attachment") {
    const attachment = value.attachment;
    if (!isObject(attachment)) {
      return null;
    }
    const id = readString(attachment.id);
    const mime = readString(attachment.mime);
    const url = readString(attachment.url);
    if (id === null || mime === null || url === null) {
      return null;
    }
    return {
      kind: "attachment",
      attachment: {
        id,
        mime,
        url,
        ...(attachment.filename !== undefined ? { filename: readOptionalString(attachment.filename) } : {}),
      },
    };
  }
  if (kind === "diff") {
    const diff = value.diff;
    if (!isObject(diff)) {
      return null;
    }
    const id = readString(diff.id);
    if (id === null) {
      return null;
    }
    const files = Array.isArray(diff.files)
      ? diff.files.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    return {
      kind: "diff",
      diff: {
        id,
        ...(diff.snapshot !== undefined ? { snapshot: readOptionalString(diff.snapshot) } : {}),
        ...(files !== undefined ? { files } : {}),
      },
    };
  }
  if (kind === "cost") {
    const cost = readNumber(value.cost);
    if (cost === null) {
      return null;
    }
    return { kind: "cost", cost };
  }
  return null;
}

function decodeParts(value: unknown): SessionTurnPart[] | null {
  const arr = readArray(value);
  if (!arr) {
    return null;
  }
  const out: SessionTurnPart[] = [];
  for (const entry of arr) {
    const part = decodePart(entry);
    if (part === null) {
      return null;
    }
    out.push(part);
  }
  return out;
}

function decodeDiagnostic(value: unknown): DiagnosticEvent | null {
  if (!isObject(value)) {
    return null;
  }
  if (readString(value.type) !== "diagnostic") {
    return null;
  }
  const level = readString(value.level);
  const message = readString(value.message);
  const nativeSessionId = readString(value.nativeSessionId);
  const seq = readNumber(value.seq);
  const at = readString(value.at);
  if (level === null || message === null || nativeSessionId === null || seq === null || at === null) {
    return null;
  }
  if (!["info", "warn", "error"].includes(level)) {
    return null;
  }
  return {
    type: "diagnostic",
    level: level as DiagnosticEvent["level"],
    message,
    nativeSessionId: asNativeSessionId(nativeSessionId),
    seq,
    at,
    ...(value.reason !== undefined ? { reason: readOptionalString(value.reason) as DiagnosticEvent["reason"] } : {}),
    ...(value.redactedRaw !== undefined ? { redactedRaw: value.redactedRaw } : {}),
  };
}

function decodeDiagnostics(value: unknown): DiagnosticEvent[] | null {
  const arr = readArray(value);
  if (!arr) {
    return null;
  }
  const out: DiagnosticEvent[] = [];
  for (const entry of arr) {
    const diagnostic = decodeDiagnostic(entry);
    if (diagnostic === null) {
      return null;
    }
    out.push(diagnostic);
  }
  return out;
}

function decodeTurn(value: unknown): SessionTurn | null {
  if (!isObject(value)) {
    return null;
  }
  const id = readString(value.id);
  const role = readString(value.role);
  const content = readString(value.content);
  const startedAt = readString(value.startedAt);
  const status = readString(value.status);
  if (id === null || role === null || content === null || startedAt === null || status === null) {
    return null;
  }
  if (role !== "user" && role !== "assistant") {
    return null;
  }
  if (!TURN_STATUSES.includes(status as TurnStatus)) {
    return null;
  }
  const reasoning = value.reasoning !== undefined ? decodeReasoning(value.reasoning, "reasoning") : [];
  const toolCalls = value.toolCalls !== undefined ? decodeToolCalls(value.toolCalls) : [];
  const parts = value.parts !== undefined ? decodeParts(value.parts) : [];
  if (reasoning === null || toolCalls === null || parts === null) {
    return null;
  }
  return {
    id: asTurnId(id),
    role,
    content,
    reasoning,
    toolCalls,
    parts,
    startedAt,
    finishedAt: readOptionalString(value.finishedAt),
    status: status as TurnStatus,
    ...(value.usage !== undefined ? { usage: value.usage as never } : {}),
    ...(value.cost !== undefined ? { cost: readOptionalNumber(value.cost) } : {}),
  };
}

function decodeTranscript(value: unknown): DecodeResult<SessionRecord["transcript"]> {
  if (!isObject(value)) {
    return decodeFailure("transcript must be an object");
  }
  const turnsArr = readArray(value.turns);
  if (turnsArr === null) {
    return decodeFailure("transcript.turns must be an array");
  }
  const turns: SessionTurn[] = [];
  for (const entry of turnsArr) {
    const turn = decodeTurn(entry);
    if (turn === null) {
      return decodeFailure("transcript.turns contained a malformed turn");
    }
    turns.push(turn);
  }
  const diagnostics =
    value.diagnostics !== undefined ? decodeDiagnostics(value.diagnostics) : [];
  if (diagnostics === null) {
    return decodeFailure("transcript.diagnostics was malformed");
  }
  const transcript = { ...emptyTranscript(), turns, diagnostics };
  if (value.compaction !== undefined) {
    if (!isObject(value.compaction)) {
      return decodeFailure("transcript.compaction must be an object");
    }
    const count = readNumber(value.compaction.count);
    const lastAt = readString(value.compaction.lastAt);
    const removedMessageCount = readNumber(value.compaction.removedMessageCount);
    if (count === null || lastAt === null || removedMessageCount === null) {
      return decodeFailure("transcript.compaction was malformed");
    }
    (transcript as SessionRecord["transcript"]).compaction = { count, lastAt, removedMessageCount };
  }
  return { ok: true, value: transcript };
}

// ---------------------------------------------------------------------------
// Session-ref decode
// ---------------------------------------------------------------------------

function decodeSessionRef(value: unknown): DecodeResult<AgentSessionRef> {
  if (!isObject(value)) {
    return decodeFailure("session must be an object");
  }
  const id = readString(value.id);
  const runtimeId = readString(value.runtimeId);
  const workspaceRootPath = readString(value.workspaceRootPath);
  const createdAt = readString(value.createdAt);
  const updatedAt = readString(value.updatedAt);
  const status = readString(value.status);
  if (
    id === null ||
    runtimeId === null ||
    workspaceRootPath === null ||
    createdAt === null ||
    updatedAt === null ||
    status === null
  ) {
    return decodeFailure("session is missing required string fields");
  }
  if (!isAgentRuntimeId(runtimeId)) {
    return decodeFailure(`session has unknown runtimeId: ${runtimeId}`);
  }
  if (!isSessionLifecycleStatus(status)) {
    return decodeFailure(`session has unknown status: ${status}`);
  }
  if (!isObject(value.native)) {
    return decodeFailure("session.native must be an object");
  }
  const nativeRuntimeId = readString(value.native.runtimeId);
  const nativeSessionId = readString(value.native.nativeSessionId);
  if (nativeRuntimeId !== runtimeId || nativeSessionId === null) {
    return decodeFailure("session.native runtime/native session id mismatch");
  }
  try {
    const ref = rehydrateSessionRef({
      id,
      runtimeId,
      native: {
        runtimeId: nativeRuntimeId as AgentSessionRef["runtimeId"],
        nativeSessionId,
        modelId: readOptionalString(value.native.modelId),
        modeId: readOptionalString(value.native.modeId),
        parentSessionId: readOptionalString(value.native.parentSessionId),
        runtimeMetadata: isObject(value.native.runtimeMetadata)
          ? (value.native.runtimeMetadata as Record<string, unknown>)
          : undefined,
      },
      workspaceRootPath,
      ...(value.model !== undefined && isObject(value.model)
        ? {
            model: {
              id: readString((value.model as Record<string, unknown>).id) ?? "",
              name: readOptionalString((value.model as Record<string, unknown>).name),
            },
          }
        : {}),
      ...(value.mode !== undefined && isObject(value.mode)
        ? {
            mode: {
              id: readString((value.mode as Record<string, unknown>).id) ?? "",
              name: readOptionalString((value.mode as Record<string, unknown>).name),
            },
          }
        : {}),
      capabilities: Array.isArray(value.capabilities) ? normalizeCapabilities(value.capabilities) : [],
      createdAt,
      updatedAt,
      lastTurnAt: readOptionalString(value.lastTurnAt),
      status,
    });
    return { ok: true, value: ref };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return decodeFailure(`session rehydration failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Public encode/decode
// ---------------------------------------------------------------------------

export function encodeSessionRecord(record: SessionRecord): string {
  return stableStringify({ ...record, version: SESSION_RECORD_VERSION });
}

export function decodeSessionRecord(raw: string): DecodeResult<SessionRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return decodeFailure("record is not valid JSON");
  }
  if (!isObject(parsed)) {
    return decodeFailure("record must be a JSON object");
  }
  if (parsed.version !== SESSION_RECORD_VERSION) {
    return decodeFailure(`record version ${String(parsed.version)} != ${SESSION_RECORD_VERSION}`);
  }
  const session = decodeSessionRef(parsed.session);
  if (!session.ok) {
    return decodeFailure(session.reason);
  }
  const transcript = decodeTranscript(parsed.transcript);
  if (!transcript.ok) {
    return decodeFailure(transcript.reason);
  }
  return { ok: true, value: { version: SESSION_RECORD_VERSION, session: session.value, transcript: transcript.value } };
}

export function encodeSessionStoreIndex(index: SessionStoreIndex): string {
  return stableStringify({ ...index, version: SESSION_STORE_INDEX_VERSION });
}

function decodeIndexEntry(value: unknown): SessionStoreIndexEntry | null {
  if (!isObject(value)) {
    return null;
  }
  const id = readString(value.id);
  const runtimeId = readString(value.runtimeId);
  const nativeSessionId = readString(value.nativeSessionId);
  const title = readString(value.title);
  const lastTurnAt = readString(value.lastTurnAt);
  const status = readString(value.status);
  if (
    id === null ||
    runtimeId === null ||
    nativeSessionId === null ||
    title === null ||
    lastTurnAt === null ||
    status === null
  ) {
    return null;
  }
  if (!isAgentRuntimeId(runtimeId) || !isSessionLifecycleStatus(status)) {
    return null;
  }
  const parentSessionId = readOptionalString(value.parentSessionId);
  const entry: SessionStoreIndexEntry = {
    id: asSpecOpsSessionId(id),
    runtimeId,
    nativeSessionId: asNativeSessionId(nativeSessionId) as NativeSessionId,
    title,
    lastTurnAt,
    status,
    ...(parentSessionId !== undefined ? { parentSessionId: asSpecOpsSessionId(parentSessionId) } : {}),
  };
  return entry;
}

export function decodeSessionStoreIndex(raw: string): DecodeResult<SessionStoreIndex> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return decodeFailure("index is not valid JSON");
  }
  if (!isObject(parsed)) {
    return decodeFailure("index must be a JSON object");
  }
  if (parsed.version !== SESSION_STORE_INDEX_VERSION) {
    return decodeFailure(`index version ${String(parsed.version)} != ${SESSION_STORE_INDEX_VERSION}`);
  }
  const workspaceRootPath = readString(parsed.workspaceRootPath);
  const sessionsArr = readArray(parsed.sessions);
  if (workspaceRootPath === null) {
    return decodeFailure("index.workspaceRootPath must be a string");
  }
  if (sessionsArr === null) {
    return decodeFailure("index.sessions must be an array");
  }
  const sessions: SessionStoreIndexEntry[] = [];
  for (const entry of sessionsArr) {
    const decoded = decodeIndexEntry(entry);
    if (decoded === null) {
      return decodeFailure("index.sessions contained a malformed entry");
    }
    sessions.push(decoded);
  }
  return {
    ok: true,
    value: { version: SESSION_STORE_INDEX_VERSION, workspaceRootPath, sessions },
  };
}

/** Re-export event types used by callers building diagnostics for decode. */
export type { SessionEvent };
