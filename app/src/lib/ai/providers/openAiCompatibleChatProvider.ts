import type { ChatModeId, HttpConnectionSettings } from "../../domain/contracts";
import {
  WorkspaceAccessReason,
  type CapabilityCheckInput,
  type CapabilityCheckResult,
} from "../capabilities";
import {
  getModeUnsupportedMessage,
  getModeUnsupportedRecovery,
} from "../chatErrorCopy";
import { ChatProviderError } from "./errors";
import {
  getHttpProviderMissingConfigMessage,
  getHttpProviderSetupHint,
  isHttpProviderConfigured,
  normalizeHttpConnectionSettings,
} from "./httpConnectionSettings";
import { mapProviderModelRuntimeError, shouldMapProviderModelRejection } from "./modelValidation";
import {
  logChatHttpError,
  logChatHttpRequest,
  logChatHttpRequestBody,
  logChatHttpResponse,
  logChatHttpResponseBody,
  logChatHttpStreamEnd,
} from "../chatDiagnostics";
import { buildOpenAiChatMessages } from "./openAiChatMessages";
import { parseOpenAiSseStream } from "./openAiSseParser";
import type {
  ChatProvider,
  ProviderSendRequest,
  ProviderSendResponse,
  ProviderStreamChunk,
} from "./types";

export type HttpSettingsReader = (connectionId?: string) => {
  settings: HttpConnectionSettings;
  apiKey: string;
};
export type SupportedModesReader = () => ChatModeId[];

export type HttpFetchFn = typeof fetch;

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: {
    message?: string;
    code?: string | number;
  };
}

export function createOpenAiCompatibleChatProvider(
  getSettings: HttpSettingsReader,
  fetchFn?: HttpFetchFn,
): ChatProvider;
export function createOpenAiCompatibleChatProvider(
  getSettings: HttpSettingsReader,
  getSupportedModes: SupportedModesReader,
  fetchFn?: HttpFetchFn,
): ChatProvider;
export function createOpenAiCompatibleChatProvider(
  getSettings: HttpSettingsReader,
  getSupportedModesOrFetchFn?: SupportedModesReader | HttpFetchFn,
  fetchFn?: HttpFetchFn,
): ChatProvider {
  const isLikelyFetchFn = typeof getSupportedModesOrFetchFn === "function" && fetchFn === undefined;
  const getSupportedModes =
    isLikelyFetchFn
      ? (() => ["ask", "review"]) as SupportedModesReader
      : (getSupportedModesOrFetchFn as SupportedModesReader | undefined) ?? (() => ["ask", "review"]);
  const resolvedFetchFn =
    isLikelyFetchFn
      ? (getSupportedModesOrFetchFn as HttpFetchFn)
      : (fetchFn ?? fetch);
  return new OpenAiCompatibleChatProvider(getSettings, getSupportedModes, resolvedFetchFn);
}

class OpenAiCompatibleChatProvider implements ChatProvider {
  readonly id = "http" as const;

  constructor(
    private readonly getSettings: HttpSettingsReader,
    private readonly getSupportedModes: SupportedModesReader,
    private readonly fetchFn: HttpFetchFn,
  ) {}

  async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
    const { settings, apiKey } = this.getSettings(input.connectionId);
    const normalized = normalizeHttpConnectionSettings(settings);

    if (!isHttpProviderConfigured(normalized, apiKey)) {
      return {
        status: "blocked",
        reason: WorkspaceAccessReason.MissingProviderConfig,
        capabilities: null,
        message: getHttpProviderMissingConfigMessage(),
        recoveryHint: getHttpProviderSetupHint(),
      };
    }

    const supportedModes = this.getSupportedModes();
    if (!supportedModes.includes(input.mode)) {
      return {
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: {
          canReadWorkspaceFiles: false,
          supportedModes: [...supportedModes],
        },
        message: getModeUnsupportedMessage(input.mode, "HTTP provider"),
        recoveryHint: getModeUnsupportedRecovery(),
      };
    }

    return {
      status: "ready",
      reason: WorkspaceAccessReason.Unknown,
      capabilities: {
        canReadWorkspaceFiles: true,
        supportedModes: [...supportedModes],
      },
      message: "HTTP provider is ready for chat.",
    };
  }

  async sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse> {
    const { settings, apiKey } = this.getSettings(request.connectionId);
    const normalized = normalizeHttpConnectionSettings(settings);
    this.assertConfigured(normalized, apiKey);

    const modelId = resolveRuntimeModelId(request.modelId);
    const messages = buildOpenAiChatMessages(request.payload);
    const url = resolveHttpChatCompletionsUrl(normalized.baseUrl);
    const startedAt = Date.now();
    const requestBody = {
      model: modelId,
      messages,
      stream: false,
    };

    logChatHttpRequest({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      url,
      modelId,
      stream: false,
    });
    logChatHttpRequestBody({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      url,
      modelId,
      stream: false,
      body: requestBody,
    });

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        signal: request.signal,
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      logChatHttpError({
        turnId: request.turnKey,
        connectionId: request.connectionId,
        modelId,
        stream: false,
        message: error instanceof Error ? error.message : "Network request failed",
        durationMs: Date.now() - startedAt,
      });
      throw mapHttpNetworkError(error);
    }

    logChatHttpResponse({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      url,
      modelId,
      stream: false,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });

    const rawBody = await response.text();
    logChatHttpResponseBody({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      modelId,
      stream: false,
      status: response.status,
      body: rawBody,
    });
    if (!response.ok) {
      throw mapHttpError(response.status, rawBody, modelId);
    }

    let parsed: OpenAiChatCompletionResponse;
    try {
      parsed = JSON.parse(rawBody) as OpenAiChatCompletionResponse;
    } catch {
      throw new ChatProviderError(
        "HTTP provider returned an invalid response.",
        "HTTP provider returned an unexpected response. Check Settings → Connections.",
      );
    }

    if (parsed.error?.message) {
      throw new ChatProviderError(
        parsed.error.message,
        sanitizeApiErrorMessage(parsed.error.message),
      );
    }

    const content = parsed.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ChatProviderError(
        "HTTP provider returned an empty response.",
        "HTTP provider returned an empty response. Try again.",
      );
    }

    return { content };
  }

  async *streamMessage(request: ProviderSendRequest): AsyncIterable<ProviderStreamChunk> {
    const { settings, apiKey } = this.getSettings(request.connectionId);
    const normalized = normalizeHttpConnectionSettings(settings);
    this.assertConfigured(normalized, apiKey);

    const modelId = resolveRuntimeModelId(request.modelId);
    const messages = buildOpenAiChatMessages(request.payload);
    const url = resolveHttpChatCompletionsUrl(normalized.baseUrl);
    const startedAt = Date.now();
    const requestBody = {
      model: modelId,
      messages,
      stream: true,
    };

    logChatHttpRequest({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      url,
      modelId,
      stream: true,
    });
    logChatHttpRequestBody({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      url,
      modelId,
      stream: true,
      body: requestBody,
    });

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        signal: request.signal,
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      logChatHttpError({
        turnId: request.turnKey,
        connectionId: request.connectionId,
        modelId,
        stream: true,
        message: error instanceof Error ? error.message : "Network request failed",
        durationMs: Date.now() - startedAt,
      });
      throw mapHttpNetworkError(error);
    }

    logChatHttpResponse({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      url,
      modelId,
      stream: true,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logChatHttpResponseBody({
        turnId: request.turnKey,
        connectionId: request.connectionId,
        modelId,
        stream: true,
        status: response.status,
        body: errorBody,
      });
      throw mapHttpError(response.status, errorBody, modelId);
    }

    if (!response.body) {
      throw new ChatProviderError(
        "HTTP provider returned an empty stream body.",
        "HTTP provider returned an empty streaming response. Try again.",
      );
    }

    let deltaCount = 0;
    let streamedBody = "";
    try {
      for await (const delta of parseOpenAiSseStream(response.body)) {
        deltaCount += 1;
        streamedBody += delta;
        yield { delta };
      }
    } catch (error) {
      logChatHttpError({
        turnId: request.turnKey,
        connectionId: request.connectionId,
        modelId,
        stream: true,
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }

    logChatHttpStreamEnd({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      modelId,
      durationMs: Date.now() - startedAt,
      deltaCount,
    });
    logChatHttpResponseBody({
      turnId: request.turnKey,
      connectionId: request.connectionId,
      modelId,
      stream: true,
      status: response.status,
      body: streamedBody,
    });
  }

  private assertConfigured(settings: HttpConnectionSettings, apiKey: string): void {
    if (!isHttpProviderConfigured(settings, apiKey)) {
      throw new ChatProviderError(
        getHttpProviderMissingConfigMessage(),
        getHttpProviderMissingConfigMessage(),
      );
    }
  }
}

function resolveRuntimeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    throw mapProviderModelRuntimeError(
      new ChatProviderError("Missing model id for HTTP request.", "Missing model id for HTTP request."),
      "http",
      modelId,
    );
  }
  return trimmed;
}

export function resolveHttpChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function mapHttpNetworkError(error: unknown): ChatProviderError {
  const detail = error instanceof Error ? error.message : "Network request failed";
  return new ChatProviderError(
    detail,
    "Could not reach the HTTP provider. Check your network and base URL in Settings → Connections.",
  );
}

function mapHttpError(status: number, rawBody: string, modelId: string): ChatProviderError {
  const apiMessage = extractApiErrorMessage(rawBody);

  if (apiMessage && shouldMapProviderModelRejection(status, apiMessage)) {
    return mapProviderModelRuntimeError(
      new ChatProviderError(apiMessage, apiMessage),
      "http",
      modelId,
    );
  }

  switch (status) {
    case 401:
      return new ChatProviderError(
        apiMessage ?? "HTTP provider rejected the request.",
        "Invalid API key for the configured HTTP provider. Check Settings → Connections.",
      );
    case 403:
      return new ChatProviderError(
        apiMessage ?? "HTTP provider access denied.",
        "HTTP provider access denied. Check your API key and permissions.",
      );
    case 429:
      return new ChatProviderError(
        apiMessage ?? "HTTP provider rate limit reached.",
        "HTTP provider rate limit reached. Wait a moment and try again.",
      );
    default:
      if (status >= 500) {
        return new ChatProviderError(
          apiMessage ?? `HTTP provider service error (${status}).`,
          "HTTP provider is temporarily unavailable. Try again later.",
        );
      }
      return new ChatProviderError(
        apiMessage ?? `HTTP provider request failed (${status}).`,
        apiMessage ?? "HTTP provider request failed. Check Settings → Connections and try again.",
      );
  }
}

function extractApiErrorMessage(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as OpenAiChatCompletionResponse;
    const message = parsed.error?.message?.trim();
    return message ? sanitizeApiErrorMessage(message) : null;
  } catch {
    return null;
  }
}

function sanitizeApiErrorMessage(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "[redacted]").trim();
}
