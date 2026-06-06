import {
  DEBUG_AGENT_PROVIDER_DISABLED_MESSAGE,
  DEBUG_AGENT_PROVIDER_DISABLED_RECOVERY,
  DEBUG_AI_PROVIDER_DISABLED_MESSAGE,
  DEBUG_AI_PROVIDER_DISABLED_RECOVERY,
  DEBUG_PROVIDER_DISABLED_MESSAGE,
  DEBUG_PROVIDER_DISABLED_RECOVERY,
} from "../chatErrorCopy";
import type {
  AppProviderSettings,
  ChatProviderId,
  DebugProviderSettings,
} from "../../domain/contracts";
import { CHAT_HTTP_CONTEXT_ID, isDebugChatProviderId } from "../../domain/contracts";

export const defaultDebugProviderSettings: DebugProviderSettings = {
  enabled: true,
  simulationSeed: null,
  delayMsMin: 200,
  delayMsMax: 1200,
  chunkCharsMin: 8,
  chunkCharsMax: 48,
  failureProbability: 0,
  failureMessage: "Simulated provider failure",
  includeDiagnostics: true,
};

export const DEBUG_PROVIDER_DISABLED_SEND_HINT = DEBUG_PROVIDER_DISABLED_MESSAGE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRange(
  min: unknown,
  max: unknown,
  defaults: { min: number; max: number },
  floor: number,
): { min: number; max: number } {
  let normalizedMin = typeof min === "number" && Number.isFinite(min) ? Math.floor(min) : defaults.min;
  let normalizedMax = typeof max === "number" && Number.isFinite(max) ? Math.floor(max) : defaults.max;
  normalizedMin = Math.max(floor, normalizedMin);
  normalizedMax = Math.max(floor, normalizedMax);
  if (normalizedMin > normalizedMax) {
    normalizedMax = normalizedMin;
  }
  return { min: normalizedMin, max: normalizedMax };
}

function normalizeSimulationSeed(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeFailureProbability(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultDebugProviderSettings.failureProbability;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeFailureMessage(value: unknown): string {
  if (typeof value !== "string") {
    return defaultDebugProviderSettings.failureMessage;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : defaultDebugProviderSettings.failureMessage;
}

/** Validates and clamps Debug provider settings on load/save. */
export function normalizeDebugProviderSettings(
  input?: Partial<DebugProviderSettings> | unknown,
): DebugProviderSettings {
  const source = isRecord(input) ? input : {};
  const delay = normalizeRange(
    source.delayMsMin,
    source.delayMsMax,
    {
      min: defaultDebugProviderSettings.delayMsMin,
      max: defaultDebugProviderSettings.delayMsMax,
    },
    0,
  );
  const chunk = normalizeRange(
    source.chunkCharsMin,
    source.chunkCharsMax,
    {
      min: defaultDebugProviderSettings.chunkCharsMin,
      max: defaultDebugProviderSettings.chunkCharsMax,
    },
    1,
  );

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : defaultDebugProviderSettings.enabled,
    simulationSeed: normalizeSimulationSeed(source.simulationSeed),
    delayMsMin: delay.min,
    delayMsMax: delay.max,
    chunkCharsMin: chunk.min,
    chunkCharsMax: chunk.max,
    failureProbability: normalizeFailureProbability(source.failureProbability),
    failureMessage: normalizeFailureMessage(source.failureMessage),
    includeDiagnostics:
      typeof source.includeDiagnostics === "boolean"
        ? source.includeDiagnostics
        : defaultDebugProviderSettings.includeDiagnostics,
  };
}

export function getDebugProviderSettingsForId(
  providerId: ChatProviderId,
  providerSettings: AppProviderSettings,
): DebugProviderSettings | null {
  if (providerId === "debug-chat") {
    return providerSettings.debugChat;
  }
  if (providerId === "debug-workspace") {
    return providerSettings.debugWorkspace;
  }
  return null;
}

export function isDebugProviderEnabled(
  providerId: ChatProviderId,
  providerSettings: AppProviderSettings,
): boolean {
  const settings = getDebugProviderSettingsForId(providerId, providerSettings);
  return settings?.enabled === true;
}

export function isDebugProviderSendBlocked(
  provider: ChatProviderId | undefined,
  providerSettings: AppProviderSettings,
): boolean {
  if (!provider || !isDebugChatProviderId(provider)) {
    return false;
  }
  return !isDebugProviderEnabled(provider, providerSettings);
}

export function getDebugProviderSendBlockHint(providerId?: ChatProviderId): string {
  if (providerId === "debug-chat") {
    return DEBUG_AI_PROVIDER_DISABLED_MESSAGE;
  }
  if (providerId === "debug-workspace") {
    return DEBUG_AGENT_PROVIDER_DISABLED_MESSAGE;
  }
  return DEBUG_PROVIDER_DISABLED_SEND_HINT;
}

export function getDebugProviderSendBlockRecovery(providerId?: ChatProviderId): string {
  if (providerId === "debug-chat") {
    return DEBUG_AI_PROVIDER_DISABLED_RECOVERY;
  }
  if (providerId === "debug-workspace") {
    return DEBUG_AGENT_PROVIDER_DISABLED_RECOVERY;
  }
  return DEBUG_PROVIDER_DISABLED_RECOVERY;
}

export function resolveDebugProviderIdForScope(scopeKey: string): ChatProviderId {
  return scopeKey === CHAT_HTTP_CONTEXT_ID ? "debug-chat" : "debug-workspace";
}

export type LegacyChatProviderId = ChatProviderId | "debug" | "glm";

export function isLegacyChatProviderId(value: unknown): value is LegacyChatProviderId {
  return (
    value === "http" ||
    value === "debug" ||
    value === "debug-chat" ||
    value === "debug-workspace" ||
    value === "glm"
  );
}

/** Maps persisted legacy provider ids to the current scoped debug provider ids. */
export function normalizeLegacyChatProviderId(
  provider: LegacyChatProviderId,
  scopeKey: string,
): ChatProviderId {
  if (provider === "glm") {
    return "http";
  }
  if (provider === "debug") {
    return resolveDebugProviderIdForScope(scopeKey);
  }
  return provider;
}

/** Remaps scoped debug providers when the active chat scope changes. */
export function coerceProviderForScope(
  provider: ChatProviderId,
  scopeKey: string,
): ChatProviderId {
  const legacy = isLegacyChatProviderId(provider)
    ? normalizeLegacyChatProviderId(provider, scopeKey)
    : provider;
  if (legacy === "debug-chat" || legacy === "debug-workspace") {
    return resolveDebugProviderIdForScope(scopeKey);
  }
  return legacy;
}
