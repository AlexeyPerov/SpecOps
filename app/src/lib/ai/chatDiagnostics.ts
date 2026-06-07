import type { ChatProviderId } from "../domain/contracts";
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

export function logChatProviderSwitch(params: {
  agentId: string;
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
      agentId: params.agentId,
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
  agentId: string;
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
      agentId: params.agentId,
      fromConnectionId: params.fromConnectionId,
      toConnectionId: params.toConnectionId,
      modelId: params.modelId,
      switched: params.switched,
      reason: params.reason,
    },
  );
}

export function logChatModelSwitch(params: {
  agentId: string;
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
      agentId: params.agentId,
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
  agentId: string;
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
  agentId: string;
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
  agentId: string;
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
