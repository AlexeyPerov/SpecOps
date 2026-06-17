import { attachOpencodeSidecarWorkspace } from "../../services/opencodeSidecar";
import type { OpencodeTransportMode } from "../../domain/contracts";
import { logDiagnostic } from "../../services/logging";
import { loadOpencodeServerPassword } from "../../services/providerSecretsStore";
import {
  createOpencodeClient as createOpencodeSdkClient,
  type OpencodeClient as OpencodeSdkClient,
} from "@opencode-ai/sdk/v2";

export type WorkspaceAgentBackendId = "opencode" | "cursor-local";

export interface WorkspaceAgentSendRequest {
  prompt: string;
  workspaceRootPath: string;
  sessionId: string;
  model?: string;
  agent?: string;
  provider?: string;
}

export interface WorkspaceAgentSession {
  id: string;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkspaceAgentRunResult {
  sessionId: string;
}

/**
 * Rich session view — what `session.list` / `session.get` / `session.fork` /
 * `session.revert` actually return. Carries the OpenCode `Session`-shape fields
 * the lifecycle UI (M2) needs that the minimal `WorkspaceAgentSession` does not:
 * share URL, parent / fork lineage, revert preview, cost snapshot, and an
 * optional title derived from the message summary. `title` is non-null here
 * because OpenCode always returns a string (may be empty) — callers normalize.
 */
export interface WorkspaceAgentSessionDetails {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** OpenCode session this one was forked from, if any. */
  parentId: string | null;
  /** Public share URL set by `session.share`, if any. */
  shareUrl: string | null;
  /** Cumulative cost (USD) snapshot from OpenCode, if any. */
  cost: number | null;
  /** Revert preview attached after a `session.revert`, if any. */
  revert: WorkspaceAgentSessionRevert | null;
}

export interface WorkspaceAgentSessionRevert {
  messageId: string;
  partId: string | null;
  /** Unified diff of file changes the revert would undo. */
  diff: string | null;
  /** Snapshot id the revert restored to, if any. */
  snapshot: string | null;
}

/** Raw OpenCode session.messages entry: { info, parts }. */
export interface OpencodeSessionMessageEntry {
  info: unknown;
  parts: unknown;
}

export type WorkspacePermissionReply = "once" | "always" | "reject";

export interface WorkspacePermissionReplyRequest {
  workspaceRootPath: string;
  sessionId: string;
  requestId: string;
  reply: WorkspacePermissionReply;
  message?: string;
}

export interface WorkspaceQuestionReplyRequest {
  workspaceRootPath: string;
  sessionId: string;
  requestId: string;
  answers: string[][];
}

export interface WorkspaceQuestionRejectRequest {
  workspaceRootPath: string;
  sessionId: string;
  requestId: string;
  message?: string;
}

export interface OpencodeModelEntry {
  id: string;
  name: string;
  providerId?: string;
}

export interface OpencodeProviderEntry {
  id: string;
  name: string;
}

export interface OpencodeAgentEntry {
  id: string;
  name: string;
}

export type WorkspaceAgentStreamEvent =
  | {
      type: "message.delta";
      delta: string;
    }
  | {
      type: "message.completed";
      message: string;
    }
  | {
      type: "reasoning.delta";
      reasoningId: string | null;
      delta: string;
    }
  | {
      type: "reasoning.ended";
      reasoningId: string | null;
      text: string;
    }
  | {
      type: "subtask.started";
      subtaskId: string | null;
      agent: string;
      description: string | null;
      prompt: string | null;
    }
  | {
      type: "step.started";
      stepId: string | null;
      agent: string | null;
      modelId: string | null;
      providerId: string | null;
    }
  | {
      type: "step.finished";
      stepId: string | null;
      reason: string | null;
      cost: number;
      tokens: WorkspaceAgentTokenUsage;
    }
  | {
      type: "step.failed";
      stepId: string | null;
      message: string;
    }
  | {
      type: "tool.started";
      toolName: string;
      callId: string | null;
      input: unknown;
    }
  | {
      type: "tool.completed";
      toolName: string;
      callId: string | null;
      output: unknown;
      isError: boolean;
    }
  | {
      type: "tool.progress";
      toolName: string;
      callId: string | null;
      output: unknown;
    }
  | {
      type: "permission.requested";
      permissionId: string;
      label: string;
      payload: unknown;
    }
  | {
      type: "question.requested";
      questionId: string;
      prompt: string;
      choices: string[];
      payload: unknown;
    }
  | {
      type: "run.completed";
    }
  | {
      type: "run.failed";
      message: string;
    };

export interface WorkspaceAgentTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

export type WorkspaceAgentBackendErrorCode =
  | "authFailure"
  | "serverUnavailable"
  | "transportError"
  | "invalidDirectory"
  | "invalidResponse"
  | "notFound";

export class WorkspaceAgentBackendError extends Error {
  readonly code: WorkspaceAgentBackendErrorCode;

  readonly status: number | null;

  readonly causeValue: unknown;

  constructor(input: {
    code: WorkspaceAgentBackendErrorCode;
    message: string;
    status?: number | null;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "WorkspaceAgentBackendError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.causeValue = input.cause;
  }
}

export interface WorkspaceAgentBackend {
  readonly id: WorkspaceAgentBackendId;
  createSession(input: {
    workspaceRootPath: string;
    title?: string;
  }): Promise<WorkspaceAgentSession>;
  getSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSession | null>;
  /**
   * Full `Session` view for one session (M2). Carries share URL, parent /
   * fork lineage, revert preview, and cost snapshot that the minimal
   * `getSession` deliberately drops.
   */
  getSessionDetails(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails | null>;
  listSessions(input: { workspaceRootPath: string }): Promise<WorkspaceAgentSession[]>;
  /**
   * Rich session list for the unified per-workspace session panel (M2-T2).
   * `?directory=` is forwarded so OpenCode filters to this workspace's
   * sessions (matches `listSessions`, but returns the richer shape that
   * carries share / fork / cost metadata).
   */
  listSessionDetails(input: {
    workspaceRootPath: string;
    search?: string;
    limit?: number;
  }): Promise<WorkspaceAgentSessionDetails[]>;
  deleteSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<boolean>;
  send(request: WorkspaceAgentSendRequest): Promise<WorkspaceAgentRunResult>;
  replyPermission(input: WorkspacePermissionReplyRequest): Promise<void>;
  replyQuestion(input: WorkspaceQuestionReplyRequest): Promise<void>;
  rejectQuestion(input: WorkspaceQuestionRejectRequest): Promise<void>;
  abortSession(input: { workspaceRootPath: string; sessionId: string }): Promise<void>;
  streamEvents(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): AsyncIterable<WorkspaceAgentStreamEvent>;
  listMessages(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<OpencodeSessionMessageEntry[]>;
  /**
   * Rename / archive a session (M2-T1). `session.update` only the title for
   * now — archive / permission / metadata are out of scope.
   */
  updateSessionTitle(input: {
    workspaceRootPath: string;
    sessionId: string;
    title: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Fork a session from a message (M2-T3). Returns the new child session's
   * details so the UI can open a fresh agent tab linked to it.
   */
  forkSession(input: {
    workspaceRootPath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Revert a session to a message in-place (M2-T4 undo). Returns the updated
   * session carrying the revert preview (diff / snapshot).
   */
  revertSession(input: {
    workspaceRootPath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Restore a previously-reverted session in-place (M2-T4 redo).
   */
  unrevertSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Create a public share URL for a session (M2-T5). Returns the updated
   * session carrying `shareUrl`.
   */
  shareSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Remove a session's share URL (M2-T5).
   */
  unshareSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Generate / refresh a session summary (M2-T6). Resolves `true` when
   * OpenCode produced a summary; the summary text arrives on subsequent
   * `session.messages` / `session.get` calls.
   */
  summarizeSession(input: {
    workspaceRootPath: string;
    sessionId: string;
    modelId?: string;
    providerId?: string;
  }): Promise<boolean>;
  /**
   * List child sessions forked from a parent (M2-T3 fork-tree navigation).
   */
  listSessionChildren(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails[]>;
  listModels(input: { workspaceRootPath: string }): Promise<OpencodeModelEntry[]>;
  listProviders(input: { workspaceRootPath: string }): Promise<OpencodeProviderEntry[]>;
  listAgents(input: { workspaceRootPath: string }): Promise<OpencodeAgentEntry[]>;
}

export class WorkspaceAgentBackendNotImplementedError extends Error {
  constructor(backendId: WorkspaceAgentBackendId) {
    super(
      `Workspace agent backend "${backendId}" is not implemented yet. Planned for phase 5.`,
    );
    this.name = "WorkspaceAgentBackendNotImplementedError";
  }
}

interface OpencodeRuntimeConfig {
  mode: OpencodeTransportMode;
  baseUrl: string;
}

export interface RawOpencodeClient {
  createSession(input: { title?: string }): Promise<unknown>;
  getSession(input: { sessionId: string }): Promise<unknown>;
  listSessions(input?: { directory?: string; search?: string; limit?: number }): Promise<unknown>;
  deleteSession(input: { sessionId: string }): Promise<unknown>;
  sendPrompt(input: { sessionId: string; prompt: string; model?: string; agent?: string; provider?: string }): Promise<unknown>;
  replyPermission(input: {
    sessionId: string;
    requestId: string;
    reply: WorkspacePermissionReply;
    message?: string;
  }): Promise<unknown>;
  replyQuestion(input: { sessionId: string; requestId: string; answers: string[][] }): Promise<unknown>;
  rejectQuestion(input: { sessionId: string; requestId: string; message?: string }): Promise<unknown>;
  abortSession(input: { sessionId: string }): Promise<unknown>;
  streamEvents(input: { sessionId: string }): AsyncIterable<unknown>;
  listMessages(input: { sessionId: string }): Promise<OpencodeSessionMessageEntry[]>;
  updateSession(input: { sessionId: string; title?: string }): Promise<unknown>;
  forkSession(input: { sessionId: string; messageId?: string }): Promise<unknown>;
  revertSession(input: { sessionId: string; messageId?: string }): Promise<unknown>;
  unrevertSession(input: { sessionId: string }): Promise<unknown>;
  shareSession(input: { sessionId: string }): Promise<unknown>;
  unshareSession(input: { sessionId: string }): Promise<unknown>;
  summarizeSession(input: {
    sessionId: string;
    modelId?: string;
    providerId?: string;
  }): Promise<unknown>;
  listSessionChildren(input: { sessionId: string }): Promise<unknown>;
  listModels(): Promise<unknown>;
  listProviders(): Promise<unknown>;
  listAgents(): Promise<unknown>;
}

interface WorkspaceAgentBackendDependencies {
  resolveRuntimeConfig?: () => Promise<OpencodeRuntimeConfig>;
  resolveServerPassword?: () => Promise<string>;
  createOpencodeClient?: (input: {
    baseUrl: string;
    workspaceRootPath: string;
    serverPassword: string;
  }) => RawOpencodeClient;
}

const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";

function assertWorkspaceRootPath(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new WorkspaceAgentBackendError({
      code: "invalidDirectory",
      message: "Workspace root path is required to use OpenCode backend.",
    });
  }
  return normalized;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function mapSession(raw: unknown): WorkspaceAgentSession {
  const payload = unwrapDataPayload(raw);
  const parsed = readObject(payload);
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid session payload.",
      cause: raw,
    });
  }
  const id = readString(parsed.id);
  if (!id) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode session payload is missing id.",
      cause: raw,
    });
  }
  return {
    id,
    title: readString(parsed.title),
    createdAt: readString(parsed.createdAt),
    updatedAt: readString(parsed.updatedAt),
  };
}

/**
 * Maps the rich `Session` shape returned by `session.get` / `session.list` /
 * `session.fork` / `session.revert` / `session.share` into SpecOps'
 * `WorkspaceAgentSessionDetails`. Reads from the unwrapped `.data` payload and
 * is tolerant of missing optional fields (share / parent / revert / cost).
 */
function mapSessionDetails(raw: unknown): WorkspaceAgentSessionDetails {
  const parsed = readObject(unwrapDataPayload(raw));
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid session payload.",
      cause: raw,
    });
  }
  const id = readString(parsed.id);
  if (!id) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode session payload is missing id.",
      cause: raw,
    });
  }
  const time = readObject(parsed.time);
  const createdAt = time ? readNumber(time.created) : null;
  const updatedAt = time ? readNumber(time.updated) : null;
  const share = readObject(parsed.share);
  const revert = readObject(parsed.revert);
  const cost = readNumber(parsed.cost);
  return {
    id,
    // OpenCode always returns a string title (may be empty); preserve verbatim.
    title: typeof parsed.title === "string" ? parsed.title : "",
    createdAt: createdAt !== null ? new Date(createdAt).toISOString() : null,
    updatedAt: updatedAt !== null ? new Date(updatedAt).toISOString() : null,
    parentId: readString(parsed.parentID) ?? readString(parsed.parentId),
    shareUrl: share ? readString(share.url) : null,
    cost: cost,
    revert: revert
      ? {
          messageId: readString(revert.messageID) ?? readString(revert.messageId) ?? "",
          partId: readString(revert.partID) ?? readString(revert.partId),
          diff: readString(revert.diff),
          snapshot: readString(revert.snapshot),
        }
      : null,
  };
}

function mapRunResult(raw: unknown, sessionId: string): WorkspaceAgentRunResult {
  const parsed = readObject(unwrapDataPayload(raw));
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid prompt response payload.",
      cause: raw,
    });
  }
  const resolvedSessionId =
    readString(parsed.sessionID) ?? readString(parsed.sessionId) ?? readString(parsed.id) ?? sessionId;
  return {
    sessionId: resolvedSessionId,
  };
}

interface StreamNormalizationState {
  seenEventKeys: Set<string>;
  startedToolCallKeys: Set<string>;
}

function emitStreamNormalizationDiagnostic(input: {
  reason: string;
  level?: "debug" | "warn";
  frame?: unknown;
  payload?: unknown;
  type?: string;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "workspace agent stream normalization",
    metadata: {
      kind: "workspace.agent.stream.normalization",
      reason: input.reason,
      type: input.type,
      frame: input.frame,
      payload: input.payload,
    },
  });
}

function readStreamPayload(frame: Record<string, unknown>): Record<string, unknown> | null {
  return readObject(frame.data) ?? readObject(frame.properties);
}

function readFrameSessionId(
  frame: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | null {
  return (
    readString(payload.sessionID) ??
    readString(payload.sessionId) ??
    readString(frame.sessionID) ??
    readString(frame.sessionId)
  );
}

function readFrameCallId(payload: Record<string, unknown>): string | null {
  return readString(payload.callID) ?? readString(payload.callId);
}

function readFrameTimestamp(
  frame: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | null {
  if (typeof payload.timestamp === "number") {
    return String(payload.timestamp);
  }
  if (typeof frame.timestamp === "number") {
    return String(frame.timestamp);
  }
  return readString(payload.timestamp) ?? readString(frame.timestamp);
}

function computeFrameDedupKey(input: {
  frame: Record<string, unknown>;
  payload: Record<string, unknown>;
  type: string;
}): string | null {
  const frameId = readString(input.frame.id);
  if (frameId) {
    return `id:${frameId}`;
  }
  const sessionId = readFrameSessionId(input.frame, input.payload);
  const callId = readFrameCallId(input.payload);
  const timestamp = readFrameTimestamp(input.frame, input.payload);
  if (!sessionId || !callId || !timestamp) {
    return null;
  }
  return `composite:${input.type}:${sessionId}:${callId}:${timestamp}`;
}

function toolCallKey(toolName: string, callId: string | null): string | null {
  if (!callId) {
    return null;
  }
  return `${toolName}:${callId}`;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTokenUsage(value: unknown): WorkspaceAgentTokenUsage | null {
  const parsed = readObject(value);
  if (!parsed) {
    return null;
  }
  const input = readNumber(parsed.input);
  const output = readNumber(parsed.output);
  const reasoning = readNumber(parsed.reasoning);
  if (input === null || output === null || reasoning === null) {
    return null;
  }
  const cache = readObject(parsed.cache);
  const cacheRead = cache ? readNumber(cache.read) : null;
  const cacheWrite = cache ? readNumber(cache.write) : null;
  if (cacheRead === null || cacheWrite === null) {
    return null;
  }
  return {
    input,
    output,
    reasoning,
    cache: { read: cacheRead, write: cacheWrite },
  };
}

function mapStreamFrame(
  raw: unknown,
  state: StreamNormalizationState,
): WorkspaceAgentStreamEvent[] {
  const parsedFrame = readObject(raw);
  if (!parsedFrame) {
    emitStreamNormalizationDiagnostic({
      reason: "malformed-frame",
      frame: raw,
    });
    return [];
  }
  const type = readString(parsedFrame.type);
  if (!type) {
    emitStreamNormalizationDiagnostic({
      reason: "missing-type",
      frame: raw,
    });
    return [];
  }
  const payload = readStreamPayload(parsedFrame);
  if (!payload) {
    emitStreamNormalizationDiagnostic({
      reason: "missing-payload",
      type,
      frame: raw,
    });
    return [];
  }
  const dedupKey = computeFrameDedupKey({ frame: parsedFrame, payload, type });
  if (dedupKey) {
    if (state.seenEventKeys.has(dedupKey)) {
      return [];
    }
    state.seenEventKeys.add(dedupKey);
  }
  if (type === "session.next.text.delta") {
    const delta = readString(payload.delta);
    if (!delta) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-text-delta",
        type,
        payload,
      });
      return [];
    }
    return [{ type: "message.delta", delta }];
  }
  if (type === "session.next.text.ended") {
    const message = readString(payload.text) ?? "";
    return [{ type: "message.completed", message }];
  }
  if (type === "session.next.reasoning.delta") {
    const delta = readString(payload.delta);
    if (!delta) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-reasoning-delta",
        type,
        payload,
      });
      return [];
    }
    const reasoningId = readString(payload.reasoningID) ?? readString(payload.reasoningId);
    return [{ type: "reasoning.delta", reasoningId, delta }];
  }
  if (type === "session.next.reasoning.ended") {
    const text = readString(payload.text) ?? "";
    const reasoningId = readString(payload.reasoningID) ?? readString(payload.reasoningId);
    return [{ type: "reasoning.ended", reasoningId, text }];
  }
  if (type === "session.next.step.started") {
    return [
      {
        type: "step.started",
        stepId: readString(payload.assistantMessageID) ?? readString(payload.assistantMessageId),
        agent: readString(payload.agent),
        modelId: readObject(payload.model) ? readString((payload.model as Record<string, unknown>).id) : null,
        providerId: readObject(payload.model)
          ? readString((payload.model as Record<string, unknown>).providerID) ??
            readString((payload.model as Record<string, unknown>).providerId)
          : null,
      },
    ];
  }
  if (type === "session.next.step.ended") {
    const tokens = readTokenUsage(payload.tokens);
    if (!tokens) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-step-tokens",
        type,
        payload,
      });
      return [];
    }
    const cost = readNumber(payload.cost) ?? 0;
    return [
      {
        type: "step.finished",
        stepId: readString(payload.assistantMessageID) ?? readString(payload.assistantMessageId),
        reason: readString(payload.finish) ?? readString(payload.reason),
        cost,
        tokens,
      },
    ];
  }
  if (type === "session.next.step.failed") {
    const errorObject = readObject(payload.error);
    const message =
      (errorObject ? readString(errorObject.message) : null) ??
      readString(payload.error) ??
      readString(payload.message) ??
      "Step failed.";
    return [
      {
        type: "step.failed",
        stepId: readString(payload.assistantMessageID) ?? readString(payload.assistantMessageId),
        message,
      },
    ];
  }
  if (type === "message.part.updated") {
    const part = readObject(payload.part);
    if (!part) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-part-updated",
        type,
        payload,
      });
      return [];
    }
    const partType = readString(part.type);
    if (partType !== "subtask") {
      return [];
    }
    const agent = readString(part.agent) ?? "subtask";
    return [
      {
        type: "subtask.started",
        subtaskId: readString(part.id),
        agent,
        description: readString(part.description),
        prompt: readString(part.prompt),
      },
    ];
  }
  if (type === "session.next.tool.called") {
    const toolName = readString(payload.tool) ?? readString(payload.toolName) ?? "unknown-tool";
    const callId = readFrameCallId(payload);
    const callKey = toolCallKey(toolName, callId);
    if (callKey) {
      state.startedToolCallKeys.add(callKey);
    }
    return [
      {
        type: "tool.started",
        toolName,
        callId,
        input: payload.input ?? null,
      },
    ];
  }
  if (type === "session.next.tool.progress") {
    const toolName = readString(payload.tool) ?? readString(payload.toolName) ?? "unknown-tool";
    return [
      {
        type: "tool.progress",
        toolName,
        callId: readFrameCallId(payload),
        output: payload.progress ?? payload.output ?? payload.result ?? payload.content ?? payload,
      },
    ];
  }
  if (type === "session.next.tool.success" || type === "session.next.tool.failed") {
    const isError = type === "session.next.tool.failed";
    const toolName = readString(payload.tool) ?? readString(payload.toolName) ?? "unknown-tool";
    const callId = readFrameCallId(payload);
    const callKey = toolCallKey(toolName, callId);
    const events: WorkspaceAgentStreamEvent[] = [];
    if (callKey && !state.startedToolCallKeys.has(callKey)) {
      events.push({
        type: "tool.started",
        toolName,
        callId,
        input: null,
      });
      state.startedToolCallKeys.add(callKey);
    }
    events.push({
      type: "tool.completed",
      toolName,
      callId,
      output: isError ? payload.error ?? payload.result ?? null : payload.result ?? payload.content ?? null,
      isError,
    });
    return events;
  }
  if (type === "permission.v2.asked") {
    const permissionId = readString(payload.id);
    const label = readString(payload.action) ?? readString(payload.permission);
    if (!permissionId || !label) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-permission-request",
        type,
        payload,
      });
      return [];
    }
    return [
      {
        type: "permission.requested",
        permissionId,
        label,
        payload,
      },
    ];
  }
  if (type === "question.v2.asked") {
    const questionId = readString(payload.id);
    const prompt = readQuestionPrompt(payload);
    if (!questionId || !prompt) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-question-request",
        type,
        payload,
      });
      return [];
    }
    const choices = readQuestionChoices(payload);
    return [
      {
        type: "question.requested",
        questionId,
        prompt,
        choices,
        payload,
      },
    ];
  }
  if (type === "session.idle") {
    return [{ type: "run.completed" }];
  }
  if (type === "session.status") {
    const status = readObject(payload.status);
    const statusType = readString(status?.type) ?? readString(payload.type);
    if (statusType === "idle") {
      return [{ type: "run.completed" }];
    }
    return [];
  }
  if (type === "session.error") {
    const errorObject = readObject(payload.error);
    const message =
      (errorObject ? readString(errorObject.message) : null) ??
      readString(payload.error) ??
      readString(payload.message) ??
      readString(payload.text) ??
      "OpenCode session failed.";
    emitStreamNormalizationDiagnostic({
      reason: "session-failed",
      level: "warn",
      type,
      payload,
    });
    return [{ type: "run.failed", message }];
  }
  emitStreamNormalizationDiagnostic({
    reason: "unknown-event-type",
    type,
    payload,
  });
  return [];
}

function mapHttpError(status: number, detail: string): WorkspaceAgentBackendError {
  if (status === 401 || status === 403) {
    return new WorkspaceAgentBackendError({
      code: "authFailure",
      status,
      message: detail || "OpenCode authentication failed. Check server password and retry.",
    });
  }
  if (status === 404) {
    return new WorkspaceAgentBackendError({
      code: "notFound",
      status,
      message: detail || "OpenCode resource was not found.",
    });
  }
  if (status === 400 && detail.toLowerCase().includes("directory")) {
    return new WorkspaceAgentBackendError({
      code: "invalidDirectory",
      status,
      message: detail || "OpenCode rejected the workspace directory.",
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new WorkspaceAgentBackendError({
      code: "serverUnavailable",
      status,
      message: detail || "OpenCode server is unavailable.",
    });
  }
  return new WorkspaceAgentBackendError({
    code: "transportError",
    status,
    message: detail || `OpenCode request failed with HTTP ${status}.`,
  });
}

function unwrapDataPayload(raw: unknown): unknown {
  const parsed = readObject(raw);
  if (!parsed) {
    return raw;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "data")) {
    return parsed.data;
  }
  return raw;
}

function unwrapSessionList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return null;
}

function readQuestionPrompt(payload: Record<string, unknown>): string | null {
  const directPrompt = readString(payload.header) ?? readString(payload.text) ?? readString(payload.prompt);
  if (directPrompt) {
    return directPrompt;
  }
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  for (const entry of questions) {
    const parsed = readObject(entry);
    const prompt = parsed ? readString(parsed.header) ?? readString(parsed.text) : null;
    if (prompt) {
      return prompt;
    }
  }
  return null;
}

function unwrapList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  const parsed = readObject(unwrapDataPayload(raw));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

function mapModelEntry(raw: unknown): OpencodeModelEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readString(parsed.name) ?? id,
    providerId: readString(parsed.providerId) ?? readString(parsed.provider) ?? undefined,
  };
}

function mapProviderEntry(raw: unknown): OpencodeProviderEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readString(parsed.name) ?? id,
  };
}

function mapAgentEntry(raw: unknown): OpencodeAgentEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readString(parsed.name) ?? readString(parsed.label) ?? id,
  };
}

function readQuestionChoices(payload: Record<string, unknown>): string[] {
  const directChoices = Array.isArray(payload.choices) ? payload.choices : [];
  if (directChoices.length > 0) {
    return directChoices
      .map((entry) => {
        if (typeof entry === "string") {
          return readString(entry);
        }
        const parsed = readObject(entry);
        return parsed ? readString(parsed.label) ?? readString(parsed.text) ?? readString(parsed.value) : null;
      })
      .filter((entry): entry is string => Boolean(entry));
  }

  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const flattened: string[] = [];
  for (const entry of questions) {
    const question = readObject(entry);
    if (!question) {
      continue;
    }
    const options = Array.isArray(question.options) ? question.options : [];
    for (const option of options) {
      if (typeof option === "string") {
        const label = readString(option);
        if (label) {
          flattened.push(label);
        }
        continue;
      }
      const parsedOption = readObject(option);
      const label = parsedOption
        ? readString(parsedOption.label) ?? readString(parsedOption.text) ?? readString(parsedOption.value)
        : null;
      if (label) {
        flattened.push(label);
      }
    }
  }
  return flattened;
}

function extractSdkErrorDetail(error: unknown): string {
  const cause = readObject((error as Error | undefined)?.cause);
  const body = cause ? cause.body : undefined;
  if (typeof body === "string" && body.trim().length > 0) {
    return body;
  }
  const bodyObject = readObject(body);
  if (bodyObject) {
    const messageField = readString(bodyObject.message);
    if (messageField) {
      return messageField;
    }
    const dataObject = readObject(bodyObject.data);
    const dataMessage = dataObject ? readString(dataObject.message) : null;
    if (dataMessage) {
      return dataMessage;
    }
  }
  const messageField = readString((error as Error | undefined)?.message);
  return messageField ?? "";
}

function mapSdkError(error: unknown): WorkspaceAgentBackendError {
  if (error instanceof WorkspaceAgentBackendError) {
    return error;
  }
  const cause = readObject((error as Error | undefined)?.cause);
  const status = cause && typeof cause.status === "number" ? cause.status : null;
  const detail = extractSdkErrorDetail(error);
  if (status === null) {
    return new WorkspaceAgentBackendError({
      code: "serverUnavailable",
      message: detail || "OpenCode server is unavailable.",
      cause: error,
    });
  }
  return mapHttpError(status, detail);
}

function createSdkOpencodeClient(input: {
  baseUrl: string;
  workspaceRootPath: string;
  serverPassword: string;
}): RawOpencodeClient {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const password = input.serverPassword?.trim() ?? "";
  const headers: Record<string, string> = {};
  if (password.length > 0) {
    headers.Authorization = `Basic ${btoa(`opencode:${password}`)}`;
  }

  const sdk: OpencodeSdkClient = createOpencodeSdkClient({
    baseUrl,
    directory: input.workspaceRootPath,
    headers,
    throwOnError: true,
  });

  async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try {
      const result = await fn();
      return result.data;
    } catch (error: unknown) {
      throw mapSdkError(error);
    }
  }

  function buildModelInput(payload: {
    model?: string;
    provider?: string;
  }): { providerID: string; modelID: string } | undefined {
    const modelId = readString(payload.model);
    const providerId = readString(payload.provider);
    if (!modelId || !providerId) {
      return undefined;
    }
    return { providerID: providerId, modelID: modelId };
  }

  return {
    async createSession(payload) {
      return call(() => sdk.session.create({ title: payload.title }));
    },
    async getSession(payload) {
      return call(() => sdk.session.get({ sessionID: payload.sessionId }));
    },
    async listSessions(payload) {
      return call(() =>
        sdk.session.list({
          ...(payload?.search ? { search: payload.search } : {}),
          ...(payload?.limit ? { limit: payload.limit } : {}),
        }),
      );
    },
    async deleteSession(payload) {
      return call(() => sdk.session.delete({ sessionID: payload.sessionId }));
    },
    async sendPrompt(payload) {
      const model = buildModelInput(payload);
      return call(() =>
        sdk.session.prompt({
          sessionID: payload.sessionId,
          parts: [{ type: "text", text: payload.prompt }],
          agent: payload.agent,
          model,
        }),
      );
    },
    async replyPermission(payload) {
      return call(() =>
        sdk.permission.reply({
          requestID: payload.requestId,
          reply: payload.reply,
          message: payload.message,
        }),
      );
    },
    async replyQuestion(payload) {
      return call(() =>
        sdk.question.reply({
          requestID: payload.requestId,
          answers: payload.answers,
        }),
      );
    },
    async rejectQuestion(payload) {
      return call(() =>
        sdk.question.reject({
          requestID: payload.requestId,
        }),
      );
    },
    async abortSession(payload) {
      return call(() => sdk.session.abort({ sessionID: payload.sessionId }));
    },
    async *streamEvents(payload) {
      const subscription = await sdk.event.subscribe().catch((error: unknown) => {
        throw mapSdkError(error);
      });
      for await (const event of subscription.stream) {
        yield event;
      }
    },
    async listMessages(payload): Promise<OpencodeSessionMessageEntry[]> {
      const data = await call(() => sdk.session.messages({ sessionID: payload.sessionId }));
      if (!Array.isArray(data)) {
        return [];
      }
      return data as OpencodeSessionMessageEntry[];
    },
    async updateSession(payload) {
      return call(() =>
        sdk.session.update({
          sessionID: payload.sessionId,
          ...(payload.title !== undefined ? { title: payload.title } : {}),
        }),
      );
    },
    async forkSession(payload) {
      return call(() =>
        sdk.session.fork({
          sessionID: payload.sessionId,
          ...(payload.messageId ? { messageID: payload.messageId } : {}),
        }),
      );
    },
    async revertSession(payload) {
      return call(() =>
        sdk.session.revert({
          sessionID: payload.sessionId,
          ...(payload.messageId ? { messageID: payload.messageId } : {}),
        }),
      );
    },
    async unrevertSession(payload) {
      return call(() => sdk.session.unrevert({ sessionID: payload.sessionId }));
    },
    async shareSession(payload) {
      return call(() => sdk.session.share({ sessionID: payload.sessionId }));
    },
    async unshareSession(payload) {
      return call(() => sdk.session.unshare({ sessionID: payload.sessionId }));
    },
    async summarizeSession(payload) {
      return call(() =>
        sdk.session.summarize({
          sessionID: payload.sessionId,
          ...(payload.providerId && payload.modelId
            ? { providerID: payload.providerId, modelID: payload.modelId }
            : {}),
        }),
      );
    },
    async listSessionChildren(payload) {
      return call(() => sdk.session.children({ sessionID: payload.sessionId }));
    },
    async listModels() {
      return call(() => sdk.config.providers());
    },
    async listProviders() {
      return call(() => sdk.provider.list());
    },
    async listAgents() {
      return call(() => sdk.app.agents());
    },
  };
}

function createCursorLocalBackend(): WorkspaceAgentBackend {
  const id: WorkspaceAgentBackendId = "cursor-local";
  const fail = (): never => {
    throw new WorkspaceAgentBackendNotImplementedError(id);
  };
  return {
    id,
    async createSession() {
      return fail();
    },
    async getSession() {
      return fail();
    },
    async getSessionDetails() {
      return fail();
    },
    async listSessions() {
      return fail();
    },
    async listSessionDetails() {
      return fail();
    },
    async deleteSession() {
      return fail();
    },
    async send() {
      return fail();
    },
    async replyPermission() {
      return fail();
    },
    async replyQuestion() {
      return fail();
    },
    async rejectQuestion() {
      return fail();
    },
    async abortSession() {
      return fail();
    },
    async *streamEvents() {
      return fail();
    },
    async listMessages() {
      return fail();
    },
    async updateSessionTitle() {
      return fail();
    },
    async forkSession() {
      return fail();
    },
    async revertSession() {
      return fail();
    },
    async unrevertSession() {
      return fail();
    },
    async shareSession() {
      return fail();
    },
    async unshareSession() {
      return fail();
    },
    async summarizeSession() {
      return fail();
    },
    async listSessionChildren() {
      return fail();
    },
    async listModels() {
      return fail();
    },
    async listProviders() {
      return fail();
    },
    async listAgents() {
      return fail();
    },
  };
}

function createOpencodeBackend(
  deps: WorkspaceAgentBackendDependencies = {},
): WorkspaceAgentBackend {
  const resolveRuntimeConfig =
    deps.resolveRuntimeConfig ??
    (async (): Promise<OpencodeRuntimeConfig> => ({
      mode: "sidecar",
      baseUrl: DEFAULT_OPENCODE_BASE_URL,
    }));
  const resolveServerPassword =
    deps.resolveServerPassword ??
    (async (): Promise<string> => {
      try {
        return await loadOpencodeServerPassword();
      } catch {
        return "";
      }
    });
  const createOpencodeClient = deps.createOpencodeClient ?? createSdkOpencodeClient;

  async function createClientForWorkspace(workspaceRootPath: string): Promise<RawOpencodeClient> {
    const directory = assertWorkspaceRootPath(workspaceRootPath);
    const [runtime, serverPassword] = await Promise.all([
      resolveRuntimeConfig(),
      resolveServerPassword(),
    ]);
    let baseUrl = runtime.baseUrl.trim();
    if (runtime.mode === "sidecar") {
      const sidecar = await attachOpencodeSidecarWorkspace(directory).catch((error: unknown) => {
        throw new WorkspaceAgentBackendError({
          code: "serverUnavailable",
          message: "Failed to start or attach OpenCode sidecar.",
          cause: error,
        });
      });
      baseUrl = sidecar.baseUrl ?? baseUrl;
    }
    if (baseUrl.length === 0) {
      throw new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "OpenCode base URL is missing.",
      });
    }
    return createOpencodeClient({ baseUrl, workspaceRootPath: directory, serverPassword });
  }

  return {
    id: "opencode",
    async createSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.createSession({ title: input.title });
      return mapSession(raw);
    },
    async getSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.getSession({ sessionId: input.sessionId });
        return mapSession(raw);
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return null;
        }
        throw error;
      }
    },
    async getSessionDetails(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.getSession({ sessionId: input.sessionId });
        return mapSessionDetails(raw);
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return null;
        }
        throw error;
      }
    },
    async listSessions(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listSessions();
      const entries = unwrapSessionList(raw);
      if (!entries) {
        throw new WorkspaceAgentBackendError({
          code: "invalidResponse",
          message: "OpenCode sessions response must be an array.",
          cause: raw,
        });
      }
      return entries.map((entry) => mapSession(entry));
    },
    async listSessionDetails(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listSessions({
        ...(input.search ? { search: input.search } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      });
      const entries = unwrapSessionList(raw);
      if (!entries) {
        return [];
      }
      return entries.map((entry) => mapSessionDetails(entry));
    },
    async deleteSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        await client.deleteSession({ sessionId: input.sessionId });
        return true;
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return false;
        }
        throw error;
      }
    },
    async send(request) {
      const client = await createClientForWorkspace(request.workspaceRootPath);
      const raw = await client.sendPrompt({
        sessionId: request.sessionId,
        prompt: request.prompt,
        model: request.model,
        agent: request.agent,
        provider: request.provider,
      });
      return mapRunResult(raw, request.sessionId);
    },
    async replyPermission(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.replyPermission({
        sessionId: input.sessionId,
        requestId: input.requestId,
        reply: input.reply,
        message: input.message,
      });
    },
    async replyQuestion(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.replyQuestion({
        sessionId: input.sessionId,
        requestId: input.requestId,
        answers: input.answers,
      });
    },
    async rejectQuestion(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.rejectQuestion({
        sessionId: input.sessionId,
        requestId: input.requestId,
        message: input.message,
      });
    },
    async abortSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.abortSession({
        sessionId: input.sessionId,
      });
    },
    async *streamEvents(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const state: StreamNormalizationState = {
        seenEventKeys: new Set<string>(),
        startedToolCallKeys: new Set<string>(),
      };
      for await (const event of client.streamEvents({
        sessionId: input.sessionId,
      })) {
        const normalized = mapStreamFrame(event, state);
        for (const normalizedEvent of normalized) {
          yield normalizedEvent;
        }
      }
    },
    async listMessages(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.listMessages({ sessionId: input.sessionId });
        const entries = unwrapList(raw);
        if (!entries) {
          return [];
        }
        return entries.map((entry) => {
          const parsed = readObject(entry) ?? {};
          return {
            info: parsed.info ?? null,
            parts: Array.isArray(parsed.parts) ? parsed.parts : [],
          };
        });
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return [];
        }
        throw error;
      }
    },
    async updateSessionTitle(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.updateSession({
        sessionId: input.sessionId,
        title: input.title,
      });
      return mapSessionDetails(raw);
    },
    async forkSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.forkSession({
        sessionId: input.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
      });
      return mapSessionDetails(raw);
    },
    async revertSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.revertSession({
        sessionId: input.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
      });
      return mapSessionDetails(raw);
    },
    async unrevertSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.unrevertSession({ sessionId: input.sessionId });
      return mapSessionDetails(raw);
    },
    async shareSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.shareSession({ sessionId: input.sessionId });
      return mapSessionDetails(raw);
    },
    async unshareSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.unshareSession({ sessionId: input.sessionId });
      return mapSessionDetails(raw);
    },
    async summarizeSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.summarizeSession({
        sessionId: input.sessionId,
        ...(input.modelId && input.providerId
          ? { modelId: input.modelId, providerId: input.providerId }
          : {}),
      });
      return raw === true || raw === "true";
    },
    async listSessionChildren(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listSessionChildren({ sessionId: input.sessionId });
      const entries = unwrapSessionList(raw);
      if (!entries) {
        return [];
      }
      return entries.map((entry) => mapSessionDetails(entry));
    },
    async listModels(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listModels();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries.map(mapModelEntry).filter((entry): entry is OpencodeModelEntry => entry !== null);
    },
    async listProviders(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listProviders();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries.map(mapProviderEntry).filter((entry): entry is OpencodeProviderEntry => entry !== null);
    },
    async listAgents(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listAgents();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries.map(mapAgentEntry).filter((entry): entry is OpencodeAgentEntry => entry !== null);
    },
  };
}

export function createWorkspaceAgentBackend(
  id: WorkspaceAgentBackendId,
  deps: WorkspaceAgentBackendDependencies = {},
): WorkspaceAgentBackend {
  if (id === "opencode") {
    return createOpencodeBackend(deps);
  }
  return createCursorLocalBackend();
}
