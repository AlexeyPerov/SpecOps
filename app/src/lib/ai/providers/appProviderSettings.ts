import type {
  AppProviderSettings,
  DebugProviderSettings,
  HttpConnection,
  HttpConnectionSettings,
  ProviderModelCatalogs,
  ProviderSettingsById,
} from "../../domain/contracts";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "./debugProviderSettings";
import {
  defaultHttpConnection,
  DEFAULT_HTTP_CONNECTION_ID,
  defaultHttpConnectionSettings,
  normalizeHttpConnection,
  normalizeHttpConnections,
  normalizeHttpConnectionSettings,
} from "./httpConnectionSettings";

export const defaultAppProviderSettings: AppProviderSettings = {
  httpConnections: [defaultHttpConnection],
  defaultConnectionId: DEFAULT_HTTP_CONNECTION_ID,
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
  catalogs?: ProviderModelCatalogs,
): AppProviderSettings {
  const source = isRecord(input) ? input : {};
  const legacyDebug = resolveLegacyDebugSettings(source);
  const normalizedHttpConnections = normalizeHttpConnections(source.httpConnections);
  const defaultConnectionId =
    typeof source.defaultConnectionId === "string" && source.defaultConnectionId.trim().length > 0
      ? source.defaultConnectionId.trim()
      : normalizedHttpConnections[0]?.id ?? DEFAULT_HTTP_CONNECTION_ID;

  // Load-time normalization for legacy singleton `providerSettings.http`.
  if (isRecord(source.http) && !Array.isArray(source.httpConnections)) {
    const legacyTransport = normalizeHttpConnectionSettings(source.http);
    const legacyConnection: HttpConnection = normalizeHttpConnection({
      ...legacyTransport,
      id: DEFAULT_HTTP_CONNECTION_ID,
      label: "HTTP",
      modelCatalog: catalogs?.http,
    });
    return {
      httpConnections: [legacyConnection],
      defaultConnectionId: legacyConnection.id,
      // Transitional compatibility for legacy callers; remove after M4 migration.
      http: legacyTransport,
      debugChat: normalizeDebugProviderSettings(
        source.debugChat ?? legacyDebug ?? defaultDebugProviderSettings,
      ),
      debugWorkspace: normalizeDebugProviderSettings(
        source.debugWorkspace ?? legacyDebug ?? defaultDebugProviderSettings,
      ),
    };
  }

  return {
    httpConnections: normalizedHttpConnections,
    defaultConnectionId,
    http: normalizeHttpConnectionSettings(
      source.http ?? normalizedHttpConnections[0] ?? defaultHttpConnectionSettings,
    ),
    debugChat: normalizeDebugProviderSettings(
      source.debugChat ?? legacyDebug ?? defaultDebugProviderSettings,
    ),
    debugWorkspace: normalizeDebugProviderSettings(
      source.debugWorkspace ?? legacyDebug ?? defaultDebugProviderSettings,
    ),
  };
}

export function appHttpConnectionSettings(settings: AppProviderSettings): HttpConnectionSettings {
  return settings.httpConnections?.[0] ?? settings.http ?? defaultHttpConnectionSettings;
}

export function appDebugChatProviderSettings(settings: AppProviderSettings): DebugProviderSettings {
  return settings.debugChat;
}

export function appDebugWorkspaceProviderSettings(
  settings: AppProviderSettings,
): DebugProviderSettings {
  return settings.debugWorkspace;
}
