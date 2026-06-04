import {
  HTTP_MISSING_CONFIG_MESSAGE,
  HTTP_MISSING_CONFIG_RECOVERY,
} from "../chatErrorCopy";
import type { ChatProviderId, HttpConnectionSettings, ProviderModelCatalogs } from "../../domain/contracts";
import {
  getProviderDefaultModelId,
  normalizeProviderModelCatalogs,
} from "./providerModelCatalog";

export interface GlmProviderSettings extends HttpConnectionSettings {
  modelId: string;
}

export const defaultGlmProviderSettings: GlmProviderSettings = {
  enabled: true,
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  modelId: "glm-4-flash",
};

export const GLM_PROVIDER_MISSING_CONFIG_MESSAGE = HTTP_MISSING_CONFIG_MESSAGE;

export const GLM_PROVIDER_SETUP_HINT = HTTP_MISSING_CONFIG_RECOVERY;

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
  catalogs?: ProviderModelCatalogs,
): GlmProviderSettings {
  const source = isRecord(input) ? input : {};
  const catalogDefault =
    catalogs === undefined
      ? defaultGlmProviderSettings.modelId
      : getProviderDefaultModelId(normalizeProviderModelCatalogs(catalogs), "glm");

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaultGlmProviderSettings.enabled,
    baseUrl: normalizeNonEmptyString(source.baseUrl, defaultGlmProviderSettings.baseUrl),
    modelId: normalizeNonEmptyString(source.modelId, catalogDefault),
  };
}

/** Keeps legacy GLM modelId aligned with the GLM catalog default. */
export function syncGlmProviderSettingsWithCatalog(
  settings: GlmProviderSettings,
  catalogs: ProviderModelCatalogs,
): GlmProviderSettings {
  const defaultModelId = getProviderDefaultModelId(normalizeProviderModelCatalogs(catalogs), "glm");
  if (settings.modelId === defaultModelId) {
    return settings;
  }
  return normalizeGlmProviderSettings({ ...settings, modelId: defaultModelId }, catalogs);
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
