import { attachOpencodeSidecarWorkspace } from "../../services/opencodeSidecar";
import type { OpencodeTransportMode } from "../../domain/contracts";
import { logDiagnostic } from "../../services/logging";
import { loadOpencodeServerPassword } from "../../services/providerSecretsStore";

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
  listSessions(input: { workspaceRootPath: string }): Promise<WorkspaceAgentSession[]>;
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

interface RawOpencodeClient {
  createSession(input: { title?: string }): Promise<unknown>;
  getSession(input: { sessionId: string }): Promise<unknown>;
  listSessions(): Promise<unknown>;
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
  if (type === "session.error" || type === "session.next.step.failed") {
    const message =
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

async function toHttpError(response: Response): Promise<WorkspaceAgentBackendError> {
  const detail = readString(await response.text()) ?? "";
  return mapHttpError(response.status, detail);
}

function addQueryParams(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value.trim().length > 0) {
      query.set(key, value);
    }
  }
  const serialized = query.toString();
  if (serialized.length === 0) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${serialized}`;
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

function createHttpOpencodeClient(input: {
  baseUrl: string;
  workspaceRootPath: string;
  serverPassword: string;
}): RawOpencodeClient {
  const { workspaceRootPath } = input;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const serverPassword = input.serverPassword?.trim() ?? "";

  function authHeaders(): Record<string, string> {
    if (serverPassword.length === 0) {
      return {};
    }
    return { Authorization: `Basic ${btoa(`opencode:${serverPassword}`)}` };
  }

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${baseUrl}${addQueryParams(path, { directory: workspaceRootPath })}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
    }).catch((error: unknown) => {
      throw new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "OpenCode server is unavailable.",
        cause: error,
      });
    });
    if (!response.ok) {
      throw await toHttpError(response);
    }
    return response.status === 204 ? null : response.json();
  }

  async function requestWithFallback(paths: string[], init?: RequestInit): Promise<unknown> {
    let lastError: WorkspaceAgentBackendError | null = null;
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      try {
        return await request(path, init);
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.status === 404 || error.status === 405) &&
          index < paths.length - 1
        ) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    if (lastError) {
      throw lastError;
    }
    throw new WorkspaceAgentBackendError({
      code: "transportError",
      message: "OpenCode fallback request failed.",
    });
  }

  async function* parseSse(response: Response): AsyncIterable<unknown> {
    if (!response.body) {
      throw new WorkspaceAgentBackendError({
        code: "invalidResponse",
        message: "OpenCode stream response did not include a body.",
      });
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex >= 0) {
        const frame = buffer.slice(0, splitIndex).trim();
        buffer = buffer.slice(splitIndex + 2);
        if (frame.startsWith("data:")) {
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (data === "[DONE]") {
            return;
          }
          try {
            yield JSON.parse(data);
          } catch {
            // Ignore malformed chunks to keep the stream resilient.
          }
        }
        splitIndex = buffer.indexOf("\n\n");
      }
      if (done) {
        return;
      }
    }
  }

  return {
    async createSession(payload) {
      return request("/session", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async getSession(payload) {
      return request(`/session/${encodeURIComponent(payload.sessionId)}`);
    },
    async listSessions() {
      return request("/api/session");
    },
    async deleteSession(payload) {
      return request(`/session/${encodeURIComponent(payload.sessionId)}`, {
        method: "DELETE",
      });
    },
    async sendPrompt(payload) {
      return request(`/api/session/${encodeURIComponent(payload.sessionId)}/prompt`, {
        method: "POST",
        body: JSON.stringify({
          prompt: payload.prompt,
          model: payload.model,
          agentID: payload.agent,
          providerID: payload.provider,
        }),
      });
    },
    async replyPermission(payload) {
      return request(
        `/api/session/${encodeURIComponent(payload.sessionId)}/permission/request/${encodeURIComponent(payload.requestId)}/reply`,
        {
          method: "POST",
          body: JSON.stringify({
            reply: payload.reply,
            message: payload.message,
          }),
        },
      );
    },
    async replyQuestion(payload) {
      return request(
        `/api/session/${encodeURIComponent(payload.sessionId)}/question/request/${encodeURIComponent(payload.requestId)}/reply`,
        {
          method: "POST",
          body: JSON.stringify({
            answers: payload.answers,
          }),
        },
      );
    },
    async rejectQuestion(payload) {
      return request(
        `/api/session/${encodeURIComponent(payload.sessionId)}/question/request/${encodeURIComponent(payload.requestId)}/reject`,
        {
          method: "POST",
          body: JSON.stringify({
            message: payload.message,
          }),
        },
      );
    },
    async abortSession(payload) {
      const sessionId = encodeURIComponent(payload.sessionId);
      return requestWithFallback(
        [
          `/api/session/${sessionId}/abort`,
          `/api/session/${sessionId}/stop`,
          `/session/${sessionId}/abort`,
          `/session/${sessionId}/stop`,
        ],
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
    },
    async *streamEvents(payload) {
      async function openStream(path: string): Promise<Response> {
        return fetch(
          `${baseUrl}${addQueryParams(path, {
            directory: workspaceRootPath,
            sessionID: payload.sessionId,
            sessionId: payload.sessionId,
          })}`,
          {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              ...authHeaders(),
            },
          },
        ).catch((error: unknown) => {
          throw new WorkspaceAgentBackendError({
            code: "serverUnavailable",
            message: "OpenCode server is unavailable.",
            cause: error,
          });
        });
      }

      let response = await openStream("/api/event");
      if (!response.ok && (response.status === 404 || response.status === 405)) {
        response = await openStream("/event");
      }
      if (!response.ok) {
        throw await toHttpError(response);
      }
      yield* parseSse(response);
    },
    async listModels() {
      return request("/api/model");
    },
    async listProviders() {
      return request("/api/provider");
    },
    async listAgents() {
      return request("/api/agent");
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
    async listSessions() {
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
  const createOpencodeClient = deps.createOpencodeClient ?? createHttpOpencodeClient;

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
