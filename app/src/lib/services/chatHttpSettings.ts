import type { ChatHttpSettings } from "../domain/contracts";

export const defaultChatHttpSettings: ChatHttpSettings = {
  enabled: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isChatHttpEnabled(settings?: ChatHttpSettings | null): boolean {
  return settings?.enabled ?? false;
}

export function normalizeChatHttpSettings(input?: unknown): ChatHttpSettings {
  const source = isRecord(input) ? input : {};
  return {
    enabled: isBoolean(source.enabled) ? source.enabled : defaultChatHttpSettings.enabled,
  };
}