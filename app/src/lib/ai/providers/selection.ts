import type {
  AppProviderSettings,
  ChatProviderId,
  ChatSystemEvent,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID, PRODUCT_CHAT_PROVIDER_IDS } from "../../domain/contracts";
import { isDebugProviderEnabled } from "./debugProviderSettings";
import { listConfiguredHttpConnections, resolveHttpConnection } from "./httpConnectionSettings";
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

export interface ChatConnectionOption {
  value: string;
  label: string;
  providerId: ChatProviderId;
  connectionId?: string;
}

const HTTP_CONNECTION_VALUE_PREFIX = "http:";

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

function isDebugProviderOption(
  providerId: ChatProviderId,
  providerSettings: AppProviderSettings,
  chatContextKind: "workspace" | "chat-http",
): boolean {
  if (providerId === "debug-chat") {
    return chatContextKind === "chat-http" && isDebugProviderEnabled("debug-chat", providerSettings);
  }
  if (providerId === "debug-workspace") {
    return chatContextKind === "workspace" && isDebugProviderEnabled("debug-workspace", providerSettings);
  }
  return false;
}

function toConnectionOptionValue(connectionId: string): string {
  return `${HTTP_CONNECTION_VALUE_PREFIX}${connectionId}`;
}

export function parseChatConnectionSelection(
  value: string,
): { providerId: ChatProviderId; connectionId?: string } | null {
  if (value.startsWith(HTTP_CONNECTION_VALUE_PREFIX)) {
    const connectionId = value.slice(HTTP_CONNECTION_VALUE_PREFIX.length).trim();
    if (!connectionId) {
      return null;
    }
    return { providerId: "http", connectionId };
  }
  if (value === "debug-chat" || value === "debug-workspace") {
    return { providerId: value };
  }
  return null;
}

export function listSelectableChatConnections(
  providerSettings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
  chatContextKind: "workspace" | "chat-http",
): ChatConnectionOption[] {
  const configuredConnections: ChatConnectionOption[] = listConfiguredHttpConnections(
    providerSettings,
    apiKeys,
  ).map(
    (connection) => ({
      value: toConnectionOptionValue(connection.id),
      label: connection.label,
      providerId: "http" as const,
      connectionId: connection.id,
    }),
  );
  const debugProviderId = chatContextKind === "chat-http" ? "debug-chat" : "debug-workspace";
  if (isDebugProviderOption(debugProviderId, providerSettings, chatContextKind)) {
    configuredConnections.push({
      value: debugProviderId,
      label: PROVIDER_LABELS[debugProviderId],
      providerId: debugProviderId,
    });
  }
  return configuredConnections;
}

export function resolveActiveChatConnectionSelection(
  activeProvider: ChatProviderId,
  activeConnectionId: string | undefined,
  providerSettings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
  chatContextKind: "workspace" | "chat-http",
): string | null {
  const selectable = listSelectableChatConnections(providerSettings, apiKeys, chatContextKind);
  if (activeProvider === "http") {
    const configured = listConfiguredHttpConnections(providerSettings, apiKeys);
    if (configured.length === 0) {
      return selectable[0]?.value ?? null;
    }
    const requested = activeConnectionId?.trim();
    if (requested && configured.some((connection) => connection.id === requested)) {
      return toConnectionOptionValue(requested);
    }
    const resolved = resolveHttpConnection(providerSettings, apiKeys, activeConnectionId);
    if (resolved && configured.some((connection) => connection.id === resolved.connection.id)) {
      return toConnectionOptionValue(resolved.connection.id);
    }
    return toConnectionOptionValue(configured[0]!.id);
  }
  if (isDebugProviderOption(activeProvider, providerSettings, chatContextKind)) {
    return activeProvider;
  }
  return selectable[0]?.value ?? null;
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

export function listSelectableModelsForConnection(
  catalogs: ProviderModelCatalogs,
  providerSettings: AppProviderSettings,
  providerId: ChatProviderId,
  connectionId?: string,
): string[] {
  if (providerId !== "http") {
    return listSelectableModelsForProvider(catalogs, providerId);
  }
  const resolved = resolveHttpConnection(providerSettings, {}, connectionId);
  if (!resolved) {
    return getProviderModelCatalog(normalizeProviderModelCatalogs(catalogs), "http").modelIds;
  }
  return resolved.connection.modelCatalog.modelIds;
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
