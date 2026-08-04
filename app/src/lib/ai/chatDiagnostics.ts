import type { ChatProviderId } from "../domain/contracts";
import { isVerboseProviderLoggingEnabled } from "./providerVerboseLogging";
import type { ProviderRequestPayload } from "./providers/types";
import { logDiagnostic } from "../services/logging";

type ChatDiagnosticMetadata = Record<string, unknown>;

function emit(level: "debug" | "info" | "warn" | "error", message: string, metadata?: ChatDiagnosticMetadata): void {
  void logDiagnostic({
    level,
    source: "frontend",
    timestamp: new Date().toISOString(),
    message,
    metadata,
  });
}

/**
 * P03-08-27: cap on any single string value inside a sanitized verbose payload
 * (request/response bodies, message content). Provider bodies can run to
 * hundreds of KB; deep-cloning and stringifying them on every turn is pure
 * cost (and the debug line is dropped by the Rust plugin anyway when verbose
 * logging is off). Truncating here bounds the allocation and the JSON output.
 */
const VERBOSE_LOG_MAX_STRING_LENGTH = 8_192;

function sanitizeVerboseLogValue(value: unknown): unknown {
  if (typeof value === "string") {
    const redacted = value.replace(/Bearer\s+\S+/gi, "[redacted]");
    return redacted.length > VERBOSE_LOG_MAX_STRING_LENGTH
      ? `${redacted.slice(0, VERBOSE_LOG_MAX_STRING_LENGTH)} …[truncated ${redacted.length - VERBOSE_LOG_MAX_STRING_LENGTH} chars]`
      : redacted;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeVerboseLogValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeVerboseLogValue(entry)]),
    );
  }
  return value;
}

function sanitizeVerboseLogBody(body: unknown): unknown {
  return sanitizeVerboseLogValue(body);
}

export function logChatProviderSwitch(params: {
  sessionId: string;
  fromProvider: ChatProviderId | null;
  toProvider: ChatProviderId;
  connectionId?: string;
  modelId?: string;
  switched: boolean;
  reason?: string;
}): void {
  emit(
    params.switched ? "info" : "warn",
    params.switched ? "chat provider switched" : "chat provider switch blocked",
    {
      kind: "chat.provider-switch",
      sessionId: params.sessionId,
      fromProvider: params.fromProvider,
      toProvider: params.toProvider,
      connectionId: params.connectionId,
      modelId: params.modelId,
      switched: params.switched,
      reason: params.reason,
    },
  );
}

export function logChatConnectionSwitch(params: {
  sessionId: string;
  fromConnectionId?: string | null;
  toConnectionId: string;
  modelId?: string;
  switched: boolean;
  reason?: string;
}): void {
  emit(
    params.switched ? "info" : "warn",
    params.switched ? "chat connection switched" : "chat connection switch blocked",
    {
      kind: "chat.connection-switch",
      sessionId: params.sessionId,
      fromConnectionId: params.fromConnectionId,
      toConnectionId: params.toConnectionId,
      modelId: params.modelId,
      switched: params.switched,
      reason: params.reason,
    },
  );
}

export function logChatModelSwitch(params: {
  sessionId: string;
  providerId: ChatProviderId;
  connectionId?: string;
  fromModel?: string | null;
  toModel: string;
  switched: boolean;
  reason?: string;
}): void {
  emit(
    params.switched ? "info" : "warn",
    params.switched ? "chat model switched" : "chat model switch blocked",
    {
      kind: "chat.model-switch",
      sessionId: params.sessionId,
      providerId: params.providerId,
      connectionId: params.connectionId,
      fromModel: params.fromModel,
      toModel: params.toModel,
      switched: params.switched,
      reason: params.reason,
    },
  );
}

export function logChatSendStart(params: {
  sessionId: string;
  turnId: string;
  providerId: ChatProviderId;
  connectionId?: string;
  modelId: string;
  mode: string;
  retry?: boolean;
}): void {
  emit("info", "chat send started", {
    kind: "chat.send.start",
    ...params,
  });
}

export function logChatSendComplete(params: {
  sessionId: string;
  turnId: string;
  providerId: ChatProviderId;
  connectionId?: string;
  modelId: string;
  durationMs: number;
  contentLength: number;
}): void {
  emit("info", "chat send completed", {
    kind: "chat.send.complete",
    ...params,
  });
}

export function logChatSendFailed(params: {
  sessionId: string;
  turnId: string;
  providerId: ChatProviderId;
  connectionId?: string;
  modelId: string;
  durationMs: number;
  reason: string;
  cancelled?: boolean;
}): void {
  emit(params.cancelled ? "warn" : "error", "chat send failed", {
    kind: "chat.send.failed",
    ...params,
  });
}

export function logChatHttpRequest(params: {
  turnId?: string;
  connectionId?: string;
  url: string;
  modelId: string;
  stream: boolean;
}): void {
  emit("debug", "chat http request", {
    kind: "chat.http.request",
    ...params,
  });
}

export function logChatHttpResponse(params: {
  turnId?: string;
  connectionId?: string;
  url: string;
  modelId: string;
  stream: boolean;
  status: number;
  durationMs: number;
}): void {
  const level = params.status >= 400 ? "warn" : "debug";
  emit(level, "chat http response", {
    kind: "chat.http.response",
    ...params,
  });
}

export function logChatHttpStreamEnd(params: {
  turnId?: string;
  connectionId?: string;
  modelId: string;
  durationMs: number;
  deltaCount: number;
}): void {
  emit("debug", "chat http stream finished", {
    kind: "chat.http.stream.end",
    ...params,
  });
}

export function logChatHttpError(params: {
  turnId?: string;
  connectionId?: string;
  modelId: string;
  stream: boolean;
  message: string;
  durationMs?: number;
}): void {
  emit("error", "chat http error", {
    kind: "chat.http.error",
    ...params,
  });
}

export function logChatProviderPayload(params: {
  turnId?: string;
  providerId: ChatProviderId;
  connectionId?: string;
  modelId: string;
  payload: ProviderRequestPayload;
}): void {
  if (!isVerboseProviderLoggingEnabled()) {
    return;
  }

  emit("debug", "chat provider payload", {
    kind: "chat.provider.payload",
    turnId: params.turnId,
    providerId: params.providerId,
    connectionId: params.connectionId,
    modelId: params.modelId,
    payload: sanitizeVerboseLogBody(params.payload),
  });
}

export function logChatHttpRequestBody(params: {
  turnId?: string;
  connectionId?: string;
  url: string;
  modelId: string;
  stream: boolean;
  body: unknown;
}): void {
  if (!isVerboseProviderLoggingEnabled()) {
    return;
  }

  emit("debug", "chat http request body", {
    kind: "chat.http.request.body",
    turnId: params.turnId,
    connectionId: params.connectionId,
    url: params.url,
    modelId: params.modelId,
    stream: params.stream,
    body: sanitizeVerboseLogBody(params.body),
  });
}

export function logChatHttpResponseBody(params: {
  turnId?: string;
  connectionId?: string;
  modelId: string;
  stream: boolean;
  status: number;
  body: string;
}): void {
  if (!isVerboseProviderLoggingEnabled()) {
    return;
  }

  emit("debug", "chat http response body", {
    kind: "chat.http.response.body",
    turnId: params.turnId,
    connectionId: params.connectionId,
    modelId: params.modelId,
    stream: params.stream,
    status: params.status,
    body: sanitizeVerboseLogBody(params.body),
  });
}

export function logChatProviderResponseBody(params: {
  turnId?: string;
  providerId: ChatProviderId;
  connectionId?: string;
  modelId: string;
  stream: boolean;
  body: string;
}): void {
  if (!isVerboseProviderLoggingEnabled()) {
    return;
  }

  emit("debug", "chat provider response body", {
    kind: "chat.provider.response.body",
    turnId: params.turnId,
    providerId: params.providerId,
    connectionId: params.connectionId,
    modelId: params.modelId,
    stream: params.stream,
    body: sanitizeVerboseLogBody(params.body),
  });
}
