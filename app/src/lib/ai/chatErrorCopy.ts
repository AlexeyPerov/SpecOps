import { WorkspaceAccessReason } from "./capabilities";

export const WORKSPACE_ACCESS_BLOCKED_TITLE = "AI cannot read files in this workspace";

export const WORKSPACE_PATH_INACCESSIBLE_MESSAGE =
  "Spec Ops cannot read files at this workspace location. Chat is paused until access is restored.";

export const WORKSPACE_PATH_INACCESSIBLE_RECOVERY =
  "Close and reopen the workspace, or check that the folder exists and you have read permission.";

export const WORKSPACE_ACCESS_LOST_MESSAGE =
  "Workspace file access was lost. Chat is paused until access is restored.";

export const OPENCODE_DISABLED_MESSAGE =
  "Workspace sessions are disabled. Enable them in Settings → Workspaces to use sessions.";

export const OPENCODE_DISABLED_RECOVERY =
  "Open Settings → Workspaces and turn on workspace sessions.";

export const PROVIDER_REQUEST_FAILURE_MESSAGE = "The assistant could not finish this response.";

export const PROVIDER_REQUEST_FAILURE_RECOVERY =
  "Tap Retry to send again. If it keeps failing, check your provider settings.";

export interface ChatBlockedStateCopy {
  title: string;
  message: string;
  recoveryHint: string;
}

export function getAccessBlockedCopy(reason: WorkspaceAccessReason): ChatBlockedStateCopy {
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
        message: "Finish session setup before sending messages.",
        recoveryHint: "Open Settings → Workspaces to complete session setup.",
      };
    case WorkspaceAccessReason.ProviderUnsupported:
      return {
        title: WORKSPACE_ACCESS_BLOCKED_TITLE,
        message: "The selected provider cannot read files in this workspace.",
        recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
      };
    default:
      return {
        title: WORKSPACE_ACCESS_BLOCKED_TITLE,
        message: "Chat is unavailable until workspace access is restored.",
        recoveryHint: WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
      };
  }
}

export function formatRetryFailureNote(previousMessage: string): string {
  return `Previous response failed: ${previousMessage}`;
}

const COMPOSER_CONFIGURATION_ERROR_PATTERNS = [
  /switch models/i,
  /select an agent/i,
  /choose a model/i,
] as const;

export function isComposerConfigurationError(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return COMPOSER_CONFIGURATION_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}
