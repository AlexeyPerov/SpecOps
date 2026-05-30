import type { ChatProviderId, DebugProviderSettings, GlmProviderSettings } from "../../domain/contracts";
import type { ChatSystemEvent } from "../../domain/contracts";
import { PRODUCT_CHAT_PROVIDER_IDS } from "../../domain/contracts";
import { isGlmProviderConfigured as hasGlmProviderCredentials } from "./glmProviderSettings";

export interface ChatProviderOption {
  id: ChatProviderId;
  label: string;
}

const PROVIDER_LABELS: Record<ChatProviderId, string> = {
  glm: "GLM",
  cursor: "Cursor",
  debug: "Debug",
};

/**
 * Default provider precedence for new threads:
 * 1. GLM when configured (settings + API key, or registered adapter)
 * 2. Debug when enabled in Developer Settings
 * 3. GLM as product default fallback
 */
export function isGlmProviderConfigured(
  glmSettings: GlmProviderSettings,
  apiKey: string,
): boolean {
  return hasGlmProviderCredentials(glmSettings, apiKey);
}

export function resolveDefaultChatProvider(
  settings: DebugProviderSettings,
  glmConfigured = false,
): ChatProviderId {
  if (glmConfigured) {
    return "glm";
  }
  if (settings.enabled) {
    return "debug";
  }
  return "glm";
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

export function formatProviderSwitchNotice(event: ChatSystemEvent): string {
  const toLabel = formatChatProviderLabel(event.toProvider);
  if (event.fromProvider) {
    return `Provider switched from ${formatChatProviderLabel(event.fromProvider)} to ${toLabel}.`;
  }
  return `Provider switched to ${toLabel}.`;
}

export function canSelectChatProvider(
  provider: ChatProviderId,
  settings: DebugProviderSettings,
): boolean {
  if (provider === "debug") {
    return settings.enabled;
  }
  return provider === "glm";
}
