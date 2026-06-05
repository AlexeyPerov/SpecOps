import type { HttpConnectionSettings, ProviderModelCatalogs } from "../../domain/contracts";
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
 * the button stays **hidden** until the HTTP connection is fully configured —
 * `enabled`, non-empty trimmed API key, valid trimmed `baseUrl`, and a
 * resolvable default model in the HTTP provider catalog.
 *
 * Cloud (`chat-cloud`) rail gating is separate; this helper covers HTTP Chat only.
 */
export function isChatHttpRailVisible(
  settings: HttpConnectionSettings,
  apiKey: string,
  providerModelCatalogs: ProviderModelCatalogs,
): boolean {
  if (!isHttpProviderConfigured(settings, apiKey)) {
    return false;
  }
  return isHttpDefaultModelResolvable(providerModelCatalogs);
}
