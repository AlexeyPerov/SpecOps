import type { ChatModeId, GlmProviderSettings } from "../../domain/contracts";
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
  getGlmProviderMissingConfigMessage,
  getGlmProviderSetupHint,
  isGlmProviderConfigured,
  normalizeGlmProviderSettings,
} from "./glmProviderSettings";
import { mapProviderModelRuntimeError, shouldMapProviderModelRejection } from "./modelValidation";
import { buildGlmChatMessages } from "./glmPrompt";
import type {
  ChatProvider,
  ProviderSendRequest,
  ProviderSendResponse,
} from "./types";

export type GlmSettingsReader = () => {
  settings: GlmProviderSettings;
  apiKey: string;
};

export type GlmFetchFn = typeof fetch;

const SUPPORTED_MODES: readonly ChatModeId[] = ["ask", "review"];

interface GlmChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: {
    message?: string;
    code?: string | number;
  };
}

export function createGlmChatProvider(
  getSettings: GlmSettingsReader,
  fetchFn: GlmFetchFn = fetch,
): ChatProvider {
  return new GlmChatProvider(getSettings, fetchFn);
}

class GlmChatProvider implements ChatProvider {
  readonly id = "glm" as const;

  constructor(
    private readonly getSettings: GlmSettingsReader,
    private readonly fetchFn: GlmFetchFn,
  ) {}

  async checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult> {
    const { settings, apiKey } = this.getSettings();
    const normalized = normalizeGlmProviderSettings(settings);

    if (!isGlmProviderConfigured(normalized, apiKey)) {
      return {
        status: "blocked",
        reason: WorkspaceAccessReason.MissingProviderConfig,
        capabilities: null,
        message: getGlmProviderMissingConfigMessage(),
        recoveryHint: getGlmProviderSetupHint(),
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
        message: getModeUnsupportedMessage(input.mode, "GLM"),
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
      message: "GLM provider is ready for workspace chat.",
    };
  }

  async sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse> {
    const { settings, apiKey } = this.getSettings();
    const normalized = normalizeGlmProviderSettings(settings);
    this.assertConfigured(normalized, apiKey);

    const modelId = request.modelId.trim();
    if (!modelId) {
      throw mapProviderModelRuntimeError(
        new ChatProviderError("Missing model id for GLM request.", "Missing model id for GLM request."),
        "glm",
        request.modelId,
      );
    }

    const messages = buildGlmChatMessages(request.payload);
    const url = resolveGlmChatCompletionsUrl(normalized.baseUrl);

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
      throw mapGlmNetworkError(error);
    }

    const rawBody = await response.text();
    if (!response.ok) {
      throw mapGlmHttpError(response.status, rawBody, modelId);
    }

    let parsed: GlmChatCompletionResponse;
    try {
      parsed = JSON.parse(rawBody) as GlmChatCompletionResponse;
    } catch {
      throw new ChatProviderError(
        "GLM returned an invalid response.",
        "GLM returned an unexpected response. Try again or check Settings → GLM.",
      );
    }

    if (parsed.error?.message) {
      throw new ChatProviderError(
        parsed.error.message,
        sanitizeGlmApiErrorMessage(parsed.error.message),
      );
    }

    const content = parsed.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new ChatProviderError(
        "GLM returned an empty response.",
        "GLM returned an empty response. Try again.",
      );
    }

    return { content };
  }

  private assertConfigured(settings: GlmProviderSettings, apiKey: string): void {
    if (!isGlmProviderConfigured(settings, apiKey)) {
      throw new ChatProviderError(
        getGlmProviderMissingConfigMessage(),
        getGlmProviderMissingConfigMessage(),
      );
    }
  }
}

export function resolveGlmChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function mapGlmNetworkError(error: unknown): ChatProviderError {
  const detail = error instanceof Error ? error.message : "Network request failed";
  return new ChatProviderError(
    detail,
    "Could not reach the GLM API. Check your network connection and base URL in Settings → GLM.",
  );
}

function mapGlmHttpError(status: number, rawBody: string, modelId: string): ChatProviderError {
  const apiMessage = extractGlmApiErrorMessage(rawBody);

  if (apiMessage && shouldMapProviderModelRejection(status, apiMessage)) {
    return mapProviderModelRuntimeError(
      new ChatProviderError(apiMessage, apiMessage),
      "glm",
      modelId,
    );
  }

  switch (status) {
    case 401:
      return new ChatProviderError(
        apiMessage ?? "GLM API rejected the request.",
        "Invalid GLM API key. Check Settings → GLM.",
      );
    case 403:
      return new ChatProviderError(
        apiMessage ?? "GLM API access denied.",
        "GLM API access denied. Check your API key and subscription.",
      );
    case 429:
      return new ChatProviderError(
        apiMessage ?? "GLM rate limit reached.",
        "GLM rate limit reached. Wait a moment and try again.",
      );
    default:
      if (status >= 500) {
        return new ChatProviderError(
          apiMessage ?? `GLM service error (${status}).`,
          "GLM service is temporarily unavailable. Try again later.",
        );
      }
      return new ChatProviderError(
        apiMessage ?? `GLM request failed (${status}).`,
        apiMessage ?? "GLM request failed. Check Settings → GLM and try again.",
      );
  }
}

function extractGlmApiErrorMessage(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as GlmChatCompletionResponse;
    const message = parsed.error?.message?.trim();
    return message ? sanitizeGlmApiErrorMessage(message) : null;
  } catch {
    return null;
  }
}

function sanitizeGlmApiErrorMessage(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "[redacted]").trim();
}
