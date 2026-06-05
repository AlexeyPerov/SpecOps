import type { ChatModeId, ChatProviderId } from "../domain/contracts";
import { WorkspaceAccessReason } from "./capabilities";

export const WORKSPACE_ACCESS_BLOCKED_TITLE = "AI cannot read files in this workspace";

export const WORKSPACE_PATH_INACCESSIBLE_MESSAGE =
  "Spec Ops cannot read files at this workspace location. Chat is paused until access is restored.";

export const WORKSPACE_PATH_INACCESSIBLE_RECOVERY =
  "Close and reopen the workspace, or check that the folder exists and you have read permission.";

export const WORKSPACE_ACCESS_LOST_MESSAGE =
  "Workspace file access was lost. Chat is paused until access is restored.";

export const DEBUG_PROVIDER_SWITCH_BLOCKED_MESSAGE =
  "Enable the Debug provider in Settings → Debug AI first.";

export const HTTP_NOT_CONFIGURED_TITLE = "Connection is not configured";

export const HTTP_MISSING_CONFIG_MESSAGE =
  "Add your HTTP connection API key in Settings before sending messages.";

export const HTTP_MISSING_CONFIG_RECOVERY =
  "Open Settings → Connections, enter your API key, and try again.";

export const PROVIDER_MISSING_CONFIG_MESSAGE =
  "Complete provider setup in Settings before sending messages.";

export const PROVIDER_MISSING_CONFIG_RECOVERY =
  "Open Settings, finish setup for the selected provider, and try again.";

export const DEBUG_PROVIDER_DISABLED_TITLE = "Debug provider is disabled";

export const DEBUG_PROVIDER_DISABLED_MESSAGE =
  "The Debug provider is turned off in Developer Settings.";

export const DEBUG_PROVIDER_DISABLED_RECOVERY =
  "Open Settings → Debug AI and enable the Debug provider.";

export const PROVIDER_UNAVAILABLE_MESSAGE = "The selected provider is not available.";

export const PROVIDER_UNAVAILABLE_RECOVERY =
  "Choose HTTP or enable Debug in Settings → Debug AI.";

export const PROVIDER_UNSUPPORTED_ACCESS_MESSAGE =
  "The selected provider cannot read files in this workspace.";

export const PROVIDER_UNSUPPORTED_ACCESS_RECOVERY =
  "Choose HTTP or enable Debug in Settings → Debug AI.";

export const PROVIDER_NOT_REGISTERED_MESSAGE = "The Debug provider is not ready yet.";

export const PROVIDER_NOT_REGISTERED_RECOVERY =
  "Restart the app. If the problem continues, choose HTTP instead.";

export const PROVIDER_REQUEST_FAILURE_MESSAGE = "The assistant could not finish this response.";

export const PROVIDER_REQUEST_FAILURE_RECOVERY =
  "Tap Retry to send again. If it keeps failing, check your provider settings.";

export const STREAM_CONNECTION_FAILURE_MESSAGE =
  "HTTP provider stream failed while reading the response. Try again.";

export const STREAM_CONNECTION_FAILURE_RECOVERY =
  "Your connection may have dropped mid-response. Retry now, then check network/base URL if it repeats.";

export const STREAM_PARSE_FAILURE_MESSAGE =
  "HTTP provider returned an invalid streaming response. Try again.";

export const STREAM_PARSE_FAILURE_RECOVERY =
  "The provider returned malformed stream data. Retry once, then verify provider compatibility.";

export const STREAM_TRUNCATED_FAILURE_MESSAGE =
  "HTTP provider stream ended unexpectedly. Try again.";

export const STREAM_TRUNCATED_FAILURE_RECOVERY =
  "The stream ended before completion. Retry now; if this repeats, check provider/proxy stability.";

export const HTTP_UNAUTHORIZED_FAILURE_MESSAGE =
  "Invalid API key for the configured HTTP provider. Check Settings → Connections.";

export const HTTP_RATE_LIMIT_FAILURE_MESSAGE =
  "HTTP provider rate limit reached. Wait a moment and try again.";

export const HTTP_UNAUTHORIZED_FAILURE_RECOVERY =
  "Open Settings → Connections, update the API key, and retry.";

export const HTTP_RATE_LIMIT_FAILURE_RECOVERY =
  "Wait a short time and retry. If this happens often, lower request volume or change provider limits.";

export const LOCAL_INVALID_MODEL_MESSAGE =
  "The selected model is not in your configured model list.";

export const LOCAL_INVALID_MODEL_RECOVERY =
  "Open Settings, choose a model from the provider list, or add this model ID to the list.";

export const PROVIDER_INVALID_MODEL_MESSAGE =
  "The provider rejected or could not use the selected model.";

export const PROVIDER_INVALID_MODEL_RECOVERY =
  "Choose a different model in chat or update the model list in Settings.";

export interface ChatBlockedStateCopy {
  title: string;
  message: string;
  recoveryHint: string;
}

export function getModeUnsupportedMessage(mode: ChatModeId, providerLabel = "This provider"): string {
  return `${providerLabel} does not support ${mode} mode.`;
}

export function getModeUnsupportedRecovery(): string {
  return "Switch to Ask or Review mode.";
}

export function getUnknownProviderMessage(provider: ChatProviderId): string {
  return `${provider} is not available yet.`;
}

export function getUnknownProviderRecovery(): string {
  return PROVIDER_UNSUPPORTED_ACCESS_RECOVERY;
}

export function getAccessBlockedCopy(
  reason: WorkspaceAccessReason,
  options: { activeProvider?: ChatProviderId } = {},
): ChatBlockedStateCopy {
  switch (reason) {
    case WorkspaceAccessReason.WorkspacePathInaccessible:
      return {
        title: WORKSPACE_ACCESS_BLOCKED_TITLE,
        message: WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
        recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
      };
    case WorkspaceAccessReason.MissingProviderConfig:
      return {
        title: WORKSPACE_ACCESS_BLOCKED_TITLE,
        message: PROVIDER_MISSING_CONFIG_MESSAGE,
        recoveryHint: PROVIDER_MISSING_CONFIG_RECOVERY,
      };
    case WorkspaceAccessReason.ProviderUnsupported:
      return {
        title: WORKSPACE_ACCESS_BLOCKED_TITLE,
        message: PROVIDER_UNSUPPORTED_ACCESS_MESSAGE,
        recoveryHint: PROVIDER_UNSUPPORTED_ACCESS_RECOVERY,
      };
    default:
      return {
        title: WORKSPACE_ACCESS_BLOCKED_TITLE,
        message: "Chat is unavailable until workspace access is restored.",
        recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
      };
  }
}

export function getHttpMissingConfigCopy(): ChatBlockedStateCopy {
  return {
    title: HTTP_NOT_CONFIGURED_TITLE,
    message: HTTP_MISSING_CONFIG_MESSAGE,
    recoveryHint: HTTP_MISSING_CONFIG_RECOVERY,
  };
}

export function getDebugProviderDisabledCopy(): ChatBlockedStateCopy {
  return {
    title: DEBUG_PROVIDER_DISABLED_TITLE,
    message: DEBUG_PROVIDER_DISABLED_MESSAGE,
    recoveryHint: DEBUG_PROVIDER_DISABLED_RECOVERY,
  };
}

export function formatRetryFailureNote(previousMessage: string): string {
  return `Previous response failed: ${previousMessage}`;
}

export function getLocalInvalidModelMessage(modelId: string, providerLabel: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return LOCAL_INVALID_MODEL_MESSAGE;
  }
  return `Model "${trimmed}" is not configured for ${providerLabel}.`;
}

export function getLocalInvalidModelRecovery(_providerId?: ChatProviderId): string {
  return LOCAL_INVALID_MODEL_RECOVERY;
}

export function getLocalInvalidModelBlockedCopy(
  modelId: string,
  providerLabel: string,
): ChatBlockedStateCopy {
  return {
    title: "Model unavailable",
    message: getLocalInvalidModelMessage(modelId, providerLabel),
    recoveryHint: getLocalInvalidModelRecovery(),
  };
}

export function getProviderInvalidModelMessage(modelId: string, providerLabel: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return PROVIDER_INVALID_MODEL_MESSAGE;
  }
  return `${providerLabel} rejected model "${trimmed}". It may be invalid or temporarily unavailable.`;
}

export function getProviderInvalidModelRecovery(_providerId?: ChatProviderId): string {
  return PROVIDER_INVALID_MODEL_RECOVERY;
}

export function getProviderRuntimeModelRejectionMessage(providerLabel: string): string {
  return `${providerLabel} could not use the selected model. ${PROVIDER_INVALID_MODEL_RECOVERY}`;
}

export function sanitizeUnexpectedProviderError(error: unknown): string {
  if (!(error instanceof Error)) {
    return PROVIDER_REQUEST_FAILURE_MESSAGE;
  }

  const message = error.message.trim();
  if (!message) {
    return PROVIDER_REQUEST_FAILURE_MESSAGE;
  }

  if (message.includes("\n    at ") || message.includes("stack trace") || message.length > 240) {
    return PROVIDER_REQUEST_FAILURE_MESSAGE;
  }

  return PROVIDER_REQUEST_FAILURE_MESSAGE;
}

export function getProviderErrorRecoveryHint(message: string): string {
  if (message === STREAM_CONNECTION_FAILURE_MESSAGE) {
    return STREAM_CONNECTION_FAILURE_RECOVERY;
  }
  if (message === STREAM_PARSE_FAILURE_MESSAGE) {
    return STREAM_PARSE_FAILURE_RECOVERY;
  }
  if (message === STREAM_TRUNCATED_FAILURE_MESSAGE) {
    return STREAM_TRUNCATED_FAILURE_RECOVERY;
  }
  if (message === HTTP_UNAUTHORIZED_FAILURE_MESSAGE) {
    return HTTP_UNAUTHORIZED_FAILURE_RECOVERY;
  }
  if (message === HTTP_RATE_LIMIT_FAILURE_MESSAGE) {
    return HTTP_RATE_LIMIT_FAILURE_RECOVERY;
  }
  return PROVIDER_REQUEST_FAILURE_RECOVERY;
}
