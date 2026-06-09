import { attachOpencodeSidecarWorkspace } from "../../services/opencodeSidecar";
import type { OpencodeTransportMode } from "../../domain/contracts";

export type WorkspaceAgentBackendId = "opencode" | "cursor-local";

export interface WorkspaceAgentSendRequest {
  prompt: string;
  workspaceRootPath: string;
  sessionId: string;
  model?: string;
}

export interface WorkspaceAgentSession {
  id: string;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkspaceAgentRunResult {
  sessionId: string;
  runId: string | null;
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
      runId: string | null;
    }
  | {
      type: "run.failed";
      runId: string | null;
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
  streamEvents(input: {
    workspaceRootPath: string;
    sessionId: string;
    runId: string;
  }): AsyncIterable<WorkspaceAgentStreamEvent>;
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
  createRun(input: { sessionId: string; prompt: string; model?: string }): Promise<unknown>;
  streamRunEvents(input: { sessionId: string; runId: string }): AsyncIterable<unknown>;
}

interface WorkspaceAgentBackendDependencies {
  resolveRuntimeConfig?: () => Promise<OpencodeRuntimeConfig>;
  createOpencodeClient?: (input: {
    baseUrl: string;
    workspaceRootPath: string;
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
  const parsed = readObject(raw);
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
  const parsed = readObject(raw);
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid run payload.",
      cause: raw,
    });
  }
  return {
    sessionId,
    runId: readString(parsed.runId),
  };
}

function mapStreamEvent(raw: unknown): WorkspaceAgentStreamEvent | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const type = readString(parsed.type);
  if (!type) {
    return null;
  }
  if (type === "message.delta" || type === "messageDelta") {
    const delta = readString(parsed.delta) ?? readString(parsed.content);
    if (!delta) {
      return null;
    }
    return { type: "message.delta", delta };
  }
  if (type === "message.completed" || type === "messageComplete") {
    const message = readString(parsed.message) ?? readString(parsed.content) ?? "";
    return { type: "message.completed", message };
  }
  if (type === "tool.started" || type === "tool.call.started") {
    const toolName = readString(parsed.toolName) ?? readString(parsed.name) ?? "unknown-tool";
    return {
      type: "tool.started",
      toolName,
      callId: readString(parsed.callId),
      input: parsed.input ?? null,
    };
  }
  if (type === "tool.completed" || type === "tool.call.completed") {
    const toolName = readString(parsed.toolName) ?? readString(parsed.name) ?? "unknown-tool";
    return {
      type: "tool.completed",
      toolName,
      callId: readString(parsed.callId),
      output: parsed.output ?? null,
      isError: readBoolean(parsed.isError) ?? false,
    };
  }
  if (type === "permission.requested") {
    const permissionId = readString(parsed.permissionId);
    const label = readString(parsed.label);
    if (!permissionId || !label) {
      return null;
    }
    return {
      type: "permission.requested",
      permissionId,
      label,
      payload: parsed.payload ?? null,
    };
  }
  if (type === "question.requested") {
    const questionId = readString(parsed.questionId);
    const prompt = readString(parsed.prompt);
    if (!questionId || !prompt) {
      return null;
    }
    const rawChoices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const choices = rawChoices.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
    return {
      type: "question.requested",
      questionId,
      prompt,
      choices,
      payload: parsed.payload ?? null,
    };
  }
  if (type === "run.completed" || type === "runComplete") {
    return {
      type: "run.completed",
      runId: readString(parsed.runId),
    };
  }
  if (type === "run.failed" || type === "runError") {
    return {
      type: "run.failed",
      runId: readString(parsed.runId),
      message: readString(parsed.message) ?? "OpenCode run failed.",
    };
  }
  return null;
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

function addDirectoryParam(path: string, directory: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}directory=${encodeURIComponent(directory)}`;
}

function createHttpOpencodeClient(input: {
  baseUrl: string;
  workspaceRootPath: string;
}): RawOpencodeClient {
  const { workspaceRootPath } = input;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${baseUrl}${addDirectoryParam(path, workspaceRootPath)}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
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
      return request("/sessions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async getSession(payload) {
      return request(`/sessions/${encodeURIComponent(payload.sessionId)}`);
    },
    async listSessions() {
      return request("/sessions");
    },
    async deleteSession(payload) {
      return request(`/sessions/${encodeURIComponent(payload.sessionId)}`, {
        method: "DELETE",
      });
    },
    async createRun(payload) {
      return request(`/sessions/${encodeURIComponent(payload.sessionId)}/runs`, {
        method: "POST",
        body: JSON.stringify({
          prompt: payload.prompt,
          model: payload.model,
        }),
      });
    },
    async *streamRunEvents(payload) {
      const response = await fetch(
        `${baseUrl}${addDirectoryParam(
          `/sessions/${encodeURIComponent(payload.sessionId)}/runs/${encodeURIComponent(payload.runId)}/events`,
          workspaceRootPath,
        )}`,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
          },
        },
      ).catch((error: unknown) => {
        throw new WorkspaceAgentBackendError({
          code: "serverUnavailable",
          message: "OpenCode server is unavailable.",
          cause: error,
        });
      });
      if (!response.ok) {
        throw await toHttpError(response);
      }
      yield* parseSse(response);
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
    async *streamEvents() {
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
  const createOpencodeClient = deps.createOpencodeClient ?? createHttpOpencodeClient;

  async function createClientForWorkspace(workspaceRootPath: string): Promise<RawOpencodeClient> {
    const directory = assertWorkspaceRootPath(workspaceRootPath);
    const runtime = await resolveRuntimeConfig();
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
    return createOpencodeClient({ baseUrl, workspaceRootPath: directory });
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
      if (!Array.isArray(raw)) {
        throw new WorkspaceAgentBackendError({
          code: "invalidResponse",
          message: "OpenCode sessions response must be an array.",
          cause: raw,
        });
      }
      return raw.map((entry) => mapSession(entry));
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
      const raw = await client.createRun({
        sessionId: request.sessionId,
        prompt: request.prompt,
        model: request.model,
      });
      return mapRunResult(raw, request.sessionId);
    },
    async *streamEvents(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      for await (const event of client.streamRunEvents({
        sessionId: input.sessionId,
        runId: input.runId,
      })) {
        const normalized = mapStreamEvent(event);
        if (normalized) {
          yield normalized;
        }
      }
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
