import type {
  ChatProviderId,
  ChatSystemEvent,
  DebugProviderSettings,
  HttpConnectionSettings,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { PRODUCT_CHAT_PROVIDER_IDS } from "../../domain/contracts";
import { isHttpProviderConfigured as hasHttpProviderCredentials } from "./httpConnectionSettings";
import {
  getProviderDefaultModelId,
  getProviderModelCatalog,
  isModelInProviderCatalog,
  normalizeProviderModelCatalogs,
} from "./providerModelCatalog";

export interface ChatProviderOption {
  id: ChatProviderId;
  label: string;
}

const PROVIDER_LABELS: Record<ChatProviderId, string> = {
  http: "HTTP",
  glm: "GLM",
  cursor: "Cursor",
  debug: "Debug",
};

/**
 * Default provider precedence for new threads:
 * 1. HTTP when configured (settings + API key, or registered adapter)
 * 2. Debug when enabled in Developer Settings
 * 3. HTTP as product default fallback
 */
export function isHttpProviderConfigured(
  httpSettings: HttpConnectionSettings,
  apiKey: string,
): boolean {
  return hasHttpProviderCredentials(httpSettings, apiKey);
}

export function resolveDefaultChatProvider(
  settings: DebugProviderSettings,
  httpConfigured = false,
): ChatProviderId {
  if (httpConfigured) {
    return "http";
  }
  if (settings.enabled) {
    return "debug";
  }
  return "http";
}

export function listSelectableChatProviders(
  settings: DebugProviderSettings,
): ChatProviderOption[] {
  const options: ChatProviderOption[] = PRODUCT_CHAT_PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
  }));

  if (settings.enabled) {
    options.push({ id: "debug", label: PROVIDER_LABELS.debug });
  }

  return options;
}

export function formatChatProviderLabel(provider: ChatProviderId): string {
  return PROVIDER_LABELS[provider];
}

export function formatProviderSwitchNotice(
  event: Extract<ChatSystemEvent, { type: "provider-switched" }>,
): string {
  const toLabel = formatChatProviderLabel(event.toProvider);
  if (event.fromProvider) {
    return `Provider switched from ${formatChatProviderLabel(event.fromProvider)} to ${toLabel}.`;
  }
  return `Provider switched to ${toLabel}.`;
}

export function formatModelSwitchNotice(
  event: Extract<ChatSystemEvent, { type: "model-switched" }>,
): string {
  if (event.fromModel) {
    return `Model switched from ${event.fromModel} to ${event.toModel}.`;
  }
  return `Model switched to ${event.toModel}.`;
}

export function listSelectableModelsForProvider(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
): string[] {
  return getProviderModelCatalog(normalizeProviderModelCatalogs(catalogs), providerId).modelIds;
}

/**
 * Provider-switch model fallback: keep the current model when valid for the target
 * provider; otherwise use the target provider default from settings.
 */
export function resolveProviderSwitchModelId(
  catalogs: ProviderModelCatalogs,
  toProvider: ChatProviderId,
  currentModelId: string | undefined,
): string {
  const normalizedCatalogs = normalizeProviderModelCatalogs(catalogs);
  const trimmed = currentModelId?.trim();
  if (trimmed && isModelInProviderCatalog(normalizedCatalogs, toProvider, trimmed)) {
    return trimmed;
  }
  return getProviderDefaultModelId(normalizedCatalogs, toProvider);
}

export function canSelectChatProvider(
  provider: ChatProviderId,
  settings: DebugProviderSettings,
): boolean {
  if (provider === "debug") {
    return settings.enabled;
  }
  return provider === "http";
}
