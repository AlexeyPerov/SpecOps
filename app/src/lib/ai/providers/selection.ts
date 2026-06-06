import type {
  AppProviderSettings,
  ChatProviderId,
  ChatSystemEvent,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID, PRODUCT_CHAT_PROVIDER_IDS } from "../../domain/contracts";
import { isDebugProviderEnabled } from "./debugProviderSettings";
import { listConfiguredHttpConnections } from "./httpConnectionSettings";
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

export interface ChatProviderSelectionOptions {
  chatContextKind?: "workspace" | "chat-http";
  httpConfigured?: boolean;
}

const PROVIDER_LABELS: Record<ChatProviderId, string> = {
  http: "HTTP",
  "debug-chat": "Debug Provider",
  "debug-workspace": "Debug Provider",
};

/**
 * Default provider precedence for new threads:
 * 1. HTTP when configured (settings + API key)
 * 2. Scoped debug provider when enabled in settings
 * 3. HTTP as product default fallback
 */
export function isHttpProviderConfigured(
  providerSettings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
): boolean {
  return listConfiguredHttpConnections(providerSettings, apiKeys).length > 0;
}

export function resolveDefaultChatProvider(
  providerSettings: AppProviderSettings,
  options: ChatProviderSelectionOptions = {},
  httpConfigured = false,
): ChatProviderId {
  if (httpConfigured) {
    return "http";
  }
  const debugProviderId =
    options.chatContextKind === "chat-http" ? "debug-chat" : "debug-workspace";
  if (isDebugProviderEnabled(debugProviderId, providerSettings)) {
    return debugProviderId;
  }
  return "http";
}

export function listSelectableChatProviders(
  providerSettings: AppProviderSettings,
  options: ChatProviderSelectionOptions = {},
): ChatProviderOption[] {
  const providerOptions: ChatProviderOption[] = PRODUCT_CHAT_PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
  }));
  const isChatHttp = options.chatContextKind === "chat-http";
  const canUseHttp = options.httpConfigured === true;
  const selectable = canUseHttp
    ? providerOptions
    : providerOptions.filter((provider) => provider.id !== "http");

  const debugProviderId = isChatHttp ? "debug-chat" : "debug-workspace";
  if (isDebugProviderEnabled(debugProviderId, providerSettings)) {
    selectable.push({ id: debugProviderId, label: PROVIDER_LABELS[debugProviderId] });
  }

  return selectable;
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
  providerSettings: AppProviderSettings,
  options: ChatProviderSelectionOptions = {},
): boolean {
  if (provider === "debug-chat" || provider === "debug-workspace") {
    const expectedContext = provider === "debug-chat" ? "chat-http" : "workspace";
    if (options.chatContextKind && options.chatContextKind !== expectedContext) {
      return false;
    }
    return isDebugProviderEnabled(provider, providerSettings);
  }
  if (provider !== "http") {
    return false;
  }
  return options.httpConfigured === true;
}

export function resolveChatContextKind(scopeKey: string): "workspace" | "chat-http" {
  return scopeKey === CHAT_HTTP_CONTEXT_ID ? "chat-http" : "workspace";
}
