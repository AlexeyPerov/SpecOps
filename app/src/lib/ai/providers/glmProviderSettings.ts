import type { ChatProviderId, GlmProviderSettings } from "../../domain/contracts";

export const defaultGlmProviderSettings: GlmProviderSettings = {
  enabled: true,
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  modelId: "glm-4-flash",
};

export const GLM_PROVIDER_MISSING_CONFIG_MESSAGE =
  "GLM is not configured yet. Add an API key in Settings to send messages.";

export const GLM_PROVIDER_SETUP_HINT = "Open Settings → GLM and enter your API key.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeNonEmptyString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

/** Validates GLM provider settings on load/save. */
export function normalizeGlmProviderSettings(
  input?: Partial<GlmProviderSettings> | unknown,
): GlmProviderSettings {
  const source = isRecord(input) ? input : {};

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaultGlmProviderSettings.enabled,
    baseUrl: normalizeNonEmptyString(source.baseUrl, defaultGlmProviderSettings.baseUrl),
    modelId: normalizeNonEmptyString(source.modelId, defaultGlmProviderSettings.modelId),
  };
}

export function isGlmProviderConfigured(
  settings: GlmProviderSettings,
  apiKey: string,
): boolean {
  return settings.enabled && apiKey.trim().length > 0;
}

export function isGlmProviderSendBlocked(
  provider: ChatProviderId | undefined,
  settings: GlmProviderSettings,
  apiKey: string,
): boolean {
  return provider === "glm" && !isGlmProviderConfigured(settings, apiKey);
}

export function getGlmProviderMissingConfigMessage(): string {
  return GLM_PROVIDER_MISSING_CONFIG_MESSAGE;
}

export function getGlmProviderSetupHint(): string {
  return GLM_PROVIDER_SETUP_HINT;
}
