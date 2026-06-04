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
import { buildOpenAiChatMessages } from "./openAiChatMessages";
import type {
  ChatProvider,
  ProviderSendRequest,
  ProviderSendResponse,
} from "./types";

export type HttpSettingsReader = () => {
  settings: HttpConnectionSettings;
  apiKey: string;
};

export type HttpFetchFn = typeof fetch;

const SUPPORTED_MODES: readonly ChatModeId[] = ["ask", "review"];

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
  fetchFn: HttpFetchFn = fetch,
): ChatProvider {
  return new OpenAiCompatibleChatProvider(getSettings, fetchFn);
}

class OpenAiCompatibleChatProvider implements ChatProvider {
  readonly id = "http" as const;

  constructor(
    private readonly getSettings: HttpSettingsReader,
    private readonly fetchFn: HttpFetchFn,
  ) {}

  async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
    const { settings, apiKey } = this.getSettings();
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

    if (!SUPPORTED_MODES.includes(input.mode)) {
      return {
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: {
          canReadWorkspaceFiles: false,
          supportedModes: [...SUPPORTED_MODES],
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
        supportedModes: [...SUPPORTED_MODES],
      },
      message: "HTTP provider is ready for workspace chat.",
    };
  }

  async sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse> {
    const { settings, apiKey } = this.getSettings();
    const normalized = normalizeHttpConnectionSettings(settings);
    this.assertConfigured(normalized, apiKey);

    const modelId = request.modelId.trim();
    if (!modelId) {
      throw mapProviderModelRuntimeError(
        new ChatProviderError("Missing model id for HTTP request.", "Missing model id for HTTP request."),
        "http",
        request.modelId,
      );
    }

    const messages = buildOpenAiChatMessages(request.payload);
    const url = resolveHttpChatCompletionsUrl(normalized.baseUrl);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: false,
        }),
      });
    } catch (error) {
      throw mapHttpNetworkError(error);
    }

    const rawBody = await response.text();
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

  private assertConfigured(settings: HttpConnectionSettings, apiKey: string): void {
    if (!isHttpProviderConfigured(settings, apiKey)) {
      throw new ChatProviderError(
        getHttpProviderMissingConfigMessage(),
        getHttpProviderMissingConfigMessage(),
      );
    }
  }
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
