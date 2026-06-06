import type {
  DebugProviderSettings,
  HttpConnectionSettings,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { validateLocalModelSelection } from "./modelValidation";
import { isHttpProviderConfigured } from "./httpConnectionSettings";
import {
  getProviderDefaultModelId,
  normalizeProviderModelCatalogs,
} from "./providerModelCatalog";

function isHttpDefaultModelResolvable(providerModelCatalogs: ProviderModelCatalogs): boolean {
  const normalizedCatalogs = normalizeProviderModelCatalogs(providerModelCatalogs);
  const defaultModelId = getProviderDefaultModelId(normalizedCatalogs, "http");
  return validateLocalModelSelection(normalizedCatalogs, "http", defaultModelId).ok;
}

/**
 * Whether the activity-rail Chat button should be visible for `chat-http`.
 *
 * Gating policy ([roadmap A2D](../../../../specs/ops/roadmap.md#activity-rail-gating-a2d)):
 * show Chat when the HTTP connection is fully configured, or when Debug AI is
 * enabled for chat-http.
 */
export function isChatHttpRailVisible(
  settings: HttpConnectionSettings,
  apiKey: string,
  providerModelCatalogs: ProviderModelCatalogs,
  debugChatSettings: DebugProviderSettings,
): boolean {
  if (debugChatSettings.enabled) {
    return true;
  }
  if (!isHttpProviderConfigured(settings, apiKey)) {
    return false;
  }
  return isHttpDefaultModelResolvable(providerModelCatalogs);
}
