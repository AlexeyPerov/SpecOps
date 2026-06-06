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
  debugChat: defaultDebugProviderSettings,
  debugWorkspace: defaultDebugProviderSettings,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveLegacyDebugSettings(source: Record<string, unknown>): DebugProviderSettings | undefined {
  if (!isRecord(source.debug)) {
    return undefined;
  }
  return normalizeDebugProviderSettings(source.debug);
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
  const legacyDebug = resolveLegacyDebugSettings(source);

  return {
    http: normalizeHttpConnectionSettings(source.http),
    debugChat: normalizeDebugProviderSettings(
      source.debugChat ?? legacyDebug ?? defaultDebugProviderSettings,
    ),
    debugWorkspace: normalizeDebugProviderSettings(
      source.debugWorkspace ?? legacyDebug ?? defaultDebugProviderSettings,
    ),
  };
}

export function appHttpConnectionSettings(settings: AppProviderSettings): HttpConnectionSettings {
  return settings.http;
}

export function appDebugChatProviderSettings(settings: AppProviderSettings): DebugProviderSettings {
  return settings.debugChat;
}

export function appDebugWorkspaceProviderSettings(
  settings: AppProviderSettings,
): DebugProviderSettings {
  return settings.debugWorkspace;
}
