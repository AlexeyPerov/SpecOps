import type {
  AppProviderSettings,
  DebugProviderSettings,
  GlmProviderSettings,
  ProviderModelCatalogs,
  ProviderSettingsById,
} from "../../domain/contracts";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "./debugProviderSettings";
import {
  defaultGlmProviderSettings,
  normalizeGlmProviderSettings,
} from "./glmProviderSettings";

export const defaultAppProviderSettings: AppProviderSettings = {
  glm: defaultGlmProviderSettings,
  debug: defaultDebugProviderSettings,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Typed access to one provider's settings from the app bundle. */
export function getProviderSettings<K extends keyof ProviderSettingsById>(
  providerSettings: AppProviderSettings,
  providerId: K,
): ProviderSettingsById[K] {
  return providerSettings[providerId];
}

/** Normalizes persisted or partial provider settings for all configured providers. */
export function normalizeAppProviderSettings(
  input?: Partial<AppProviderSettings> | unknown,
  catalogs?: ProviderModelCatalogs,
): AppProviderSettings {
  const source = isRecord(input) ? input : {};
  return {
    glm: normalizeGlmProviderSettings(source.glm, catalogs),
    debug: normalizeDebugProviderSettings(source.debug),
  };
}

export function appGlmProviderSettings(settings: AppProviderSettings): GlmProviderSettings {
  return settings.glm;
}

export function appDebugProviderSettings(settings: AppProviderSettings): DebugProviderSettings {
  return settings.debug;
}
