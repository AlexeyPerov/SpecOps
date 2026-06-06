import type {
  AppProviderSettings,
  ChatProviderId,
  HttpConnection,
  HttpConnectionSettings,
  ProviderModelCatalog,
} from "../../domain/contracts";
import {
  HTTP_MISSING_CONFIG_MESSAGE,
  HTTP_MISSING_CONFIG_RECOVERY,
} from "../chatErrorCopy";
import { defaultProviderModelCatalogs, normalizeProviderModelCatalog } from "./providerModelCatalog";

export const defaultHttpConnectionSettings: HttpConnectionSettings = {
  enabled: false,
  baseUrl: "http://localhost:11434/v1",
};

export const DEFAULT_HTTP_CONNECTION_ID = "default";
export const DEFAULT_HTTP_CONNECTION_LABEL = "HTTP";

export const defaultHttpConnection: HttpConnection = {
  id: DEFAULT_HTTP_CONNECTION_ID,
  label: DEFAULT_HTTP_CONNECTION_LABEL,
  ...defaultHttpConnectionSettings,
  modelCatalog: defaultProviderModelCatalogs.http!,
};

export const HTTP_PROVIDER_MISSING_CONFIG_MESSAGE = HTTP_MISSING_CONFIG_MESSAGE;
export const HTTP_PROVIDER_SETUP_HINT = HTTP_MISSING_CONFIG_RECOVERY;

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

function normalizeConnectionId(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_HTTP_CONNECTION_ID;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_HTTP_CONNECTION_ID;
}

function normalizeConnectionLabel(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_HTTP_CONNECTION_LABEL;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_HTTP_CONNECTION_LABEL;
}

function normalizeConnectionCatalog(value: unknown): ProviderModelCatalog {
  return normalizeProviderModelCatalog("http", value ?? defaultProviderModelCatalogs.http);
}

export function normalizeHttpConnectionSettings(
  input?: Partial<HttpConnectionSettings> | unknown,
): HttpConnectionSettings {
  const source = isRecord(input) ? input : {};
  return {
    enabled:
      typeof source.enabled === "boolean" ? source.enabled : defaultHttpConnectionSettings.enabled,
    baseUrl: normalizeNonEmptyString(source.baseUrl, defaultHttpConnectionSettings.baseUrl),
  };
}

export function normalizeHttpConnection(input?: Partial<HttpConnection> | unknown): HttpConnection {
  const source = isRecord(input) ? input : {};
  const transport = normalizeHttpConnectionSettings(source);
  return {
    id: normalizeConnectionId(source.id),
    label: normalizeConnectionLabel(source.label),
    enabled: transport.enabled,
    baseUrl: transport.baseUrl,
    modelCatalog: normalizeConnectionCatalog(source.modelCatalog),
  };
}

export function normalizeHttpConnections(input?: unknown): HttpConnection[] {
  if (!Array.isArray(input)) {
    return [defaultHttpConnection];
  }
  const parsed = input.map((entry) => normalizeHttpConnection(entry));
  const dedupedById = new Map<string, HttpConnection>();
  for (const connection of parsed) {
    dedupedById.set(connection.id, connection);
  }
  return dedupedById.size > 0 ? [...dedupedById.values()] : [defaultHttpConnection];
}

export function isHttpConnectionConfigured(
  connection: HttpConnectionSettings,
  apiKey: string,
): boolean {
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(connection.baseUrl.trim());
  } catch {
    parsedUrl = null;
  }
  return Boolean(
    connection.enabled &&
      parsedUrl &&
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") &&
      apiKey.trim().length > 0,
  );
}

/** @deprecated Use `isHttpConnectionConfigured`. */
export function isHttpProviderConfigured(
  settings: HttpConnectionSettings,
  apiKey: string,
): boolean {
  return isHttpConnectionConfigured(settings, apiKey);
}

export function resolveHttpConnection(
  settings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
  connectionId?: string,
): { connection: HttpConnection; apiKey: string } | null {
  const available =
    settings.httpConnections && settings.httpConnections.length > 0
      ? settings.httpConnections
      : [normalizeHttpConnection({ ...settings.http, id: DEFAULT_HTTP_CONNECTION_ID })];
  if (available.length === 0) {
    return null;
  }
  const byId = new Map(available.map((connection) => [connection.id, connection] as const));
  const requestedId = connectionId?.trim();
  const preferredId = settings.defaultConnectionId?.trim();
  const resolved =
    (requestedId ? byId.get(requestedId) : undefined) ??
    (preferredId ? byId.get(preferredId) : undefined) ??
    available[0];
  if (!resolved) {
    return null;
  }
  return {
    connection: resolved,
    apiKey: (apiKeys[resolved.id] ?? apiKeys.http ?? "").trim(),
  };
}

export function listConfiguredHttpConnections(
  settings: AppProviderSettings,
  apiKeys: Partial<Record<string, string>>,
): HttpConnection[] {
  const available =
    settings.httpConnections && settings.httpConnections.length > 0
      ? settings.httpConnections
      : [normalizeHttpConnection({ ...settings.http, id: DEFAULT_HTTP_CONNECTION_ID })];
  return available.filter((connection) =>
    isHttpConnectionConfigured(connection, apiKeys[connection.id] ?? apiKeys.http ?? ""),
  );
}

export function isHttpProviderSendBlocked(
  provider: ChatProviderId | undefined,
  settings: HttpConnectionSettings,
  apiKey: string,
): boolean {
  return provider === "http" && !isHttpProviderConfigured(settings, apiKey);
}

export function getHttpProviderMissingConfigMessage(): string {
  return HTTP_PROVIDER_MISSING_CONFIG_MESSAGE;
}

export function getHttpProviderSetupHint(): string {
  return HTTP_PROVIDER_SETUP_HINT;
}
