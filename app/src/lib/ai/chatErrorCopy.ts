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

export const GLM_NOT_CONFIGURED_TITLE = "GLM is not configured";

export const GLM_MISSING_CONFIG_MESSAGE =
  "Add your GLM API key in Settings before sending messages.";

export const GLM_MISSING_CONFIG_RECOVERY =
  "Open Settings → GLM, enter your API key, and try again.";

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
  "Choose GLM or enable Debug in Settings → Debug AI.";

export const PROVIDER_UNSUPPORTED_ACCESS_MESSAGE =
  "The selected provider cannot read files in this workspace.";

export const PROVIDER_UNSUPPORTED_ACCESS_RECOVERY =
  "Choose GLM or enable Debug in Settings → Debug AI.";

export const PROVIDER_NOT_REGISTERED_MESSAGE = "The Debug provider is not ready yet.";

export const PROVIDER_NOT_REGISTERED_RECOVERY =
  "Restart the app. If the problem continues, choose GLM instead.";

export const PROVIDER_REQUEST_FAILURE_MESSAGE = "The assistant could not finish this response.";

export const PROVIDER_REQUEST_FAILURE_RECOVERY =
  "Tap Retry to send again. If it keeps failing, check your provider settings.";

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

export function getGlmMissingConfigCopy(): ChatBlockedStateCopy {
  return {
    title: GLM_NOT_CONFIGURED_TITLE,
    message: GLM_MISSING_CONFIG_MESSAGE,
    recoveryHint: GLM_MISSING_CONFIG_RECOVERY,
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
