import type { ChatProviderId, HttpConnectionSettings } from "../../domain/contracts";
import {
  HTTP_MISSING_CONFIG_MESSAGE,
  HTTP_MISSING_CONFIG_RECOVERY,
} from "../chatErrorCopy";

export const defaultHttpConnectionSettings: HttpConnectionSettings = {
  enabled: false,
  baseUrl: "http://localhost:11434/v1",
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

export function isHttpProviderConfigured(
  settings: HttpConnectionSettings,
  apiKey: string,
): boolean {
  return settings.enabled && settings.baseUrl.trim().length > 0 && apiKey.trim().length > 0;
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
