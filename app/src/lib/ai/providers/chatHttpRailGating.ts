import type {
  DebugProviderSettings,
  AppProviderSettings,
} from "../../domain/contracts";
import { listConfiguredHttpConnections } from "./httpConnectionSettings";

/**
 * Whether the activity-rail Chat button should be visible for `chat-http`.
 *
 * Gating policy ([roadmap A2D](../../../../specs/ops/roadmap.md#activity-rail-gating-a2d)):
 * show Chat when the HTTP connection is fully configured, or when Debug AI is
 * enabled for chat-http.
 */
export function isChatHttpRailVisible(
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
