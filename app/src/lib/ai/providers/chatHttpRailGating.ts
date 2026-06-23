import type {
  ChatHttpSettings,
  DebugProviderSettings,
  AppProviderSettings,
} from "../../domain/contracts";
import { isChatHttpEnabled } from "../../services/chatHttpSettings";
import { listConfiguredHttpConnections } from "./httpConnectionSettings";

/**
 * Whether the activity-rail Chat button should be visible for `chat-http`.
 *
 * Gating policy:
 * 1. **Master toggle** — `chatHttp.enabled` must be `true` (phase-3.5 M13).
 *    The HTTP Chat lane is an experimental beta feature and is opt-in.
 * 2. **Configuration** — either the HTTP connection is fully configured, or
 *    the Debug AI provider is enabled for chat-http.
 */
export function isChatHttpRailVisible(
  settings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
  debugChatSettings: DebugProviderSettings,
  chatHttpSettings?: ChatHttpSettings | null,
): boolean {
  if (!isChatHttpEnabled(chatHttpSettings)) {
    return false;
  }
  return isChatHttpRailConfigured(settings, apiKeys, debugChatSettings);
}

/**
 * Whether the `chat-http` context has a usable provider configuration,
 * regardless of the master beta toggle. Used by code paths that should still
 * see HTTP setup (e.g. `ChatBlockedState` CTAs, runtime validation) even
 * when the user has the beta off.
 */
export function isChatHttpRailConfigured(
  settings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
  debugChatSettings: DebugProviderSettings,
): boolean {
  if (debugChatSettings.enabled) {
    return true;
  }
  return listConfiguredHttpConnections(settings, apiKeys).some((connection) => {
    const defaultModelId = connection.modelCatalog.defaultModelId.trim();
    return (
      defaultModelId.length > 0 && connection.modelCatalog.modelIds.includes(defaultModelId)
    );
  });
}