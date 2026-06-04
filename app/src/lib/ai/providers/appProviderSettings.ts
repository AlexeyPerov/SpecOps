import type {
  AppProviderSettings,
  DebugProviderSettings,
  HttpConnectionSettings,
  ProviderModelCatalogs,
  ProviderSettingsById,
} from "../../domain/contracts";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "./debugProviderSettings";
import {
  defaultHttpConnectionSettings,
  normalizeHttpConnectionSettings,
} from "./httpConnectionSettings";

export const defaultAppProviderSettings: AppProviderSettings = {
  http: defaultHttpConnectionSettings,
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
  _catalogs?: ProviderModelCatalogs,
): AppProviderSettings {
  const source = isRecord(input) ? input : {};
  return {
    http: normalizeHttpConnectionSettings(source.http),
    debug: normalizeDebugProviderSettings(source.debug),
  };
}

export function appHttpConnectionSettings(settings: AppProviderSettings): HttpConnectionSettings {
  return settings.http;
}

export function appDebugProviderSettings(settings: AppProviderSettings): DebugProviderSettings {
  return settings.debug;
}
