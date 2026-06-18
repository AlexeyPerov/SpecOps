import type {
  NotificationEventId,
  OsNotificationSettings,
  SoundSettings,
} from "../domain/contracts";
import { NOTIFICATION_EVENT_IDS } from "../domain/contracts";

export const DEFAULT_SOUND_VOLUME = 70;

export const defaultSoundSettings: SoundSettings = {
  enabled: true,
  volume: DEFAULT_SOUND_VOLUME,
  events: allEventsEnabled(),
};

export const defaultOsNotificationSettings: OsNotificationSettings = {
  enabled: true,
  events: allEventsEnabled(),
};

function allEventsEnabled(): Record<NotificationEventId, boolean> {
  return {
    agentDone: true,
    permission: true,
    question: true,
    error: true,
  };
}

function normalizeEventFlags(
  value: unknown,
): Record<NotificationEventId, boolean> {
  const fallback = allEventsEnabled();
  if (typeof value !== "object" || value === null) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const result = { ...fallback };
  for (const eventId of NOTIFICATION_EVENT_IDS) {
    const flag = record[eventId];
    if (typeof flag === "boolean") {
      result[eventId] = flag;
    }
  }
  return result;
}

function normalizeVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SOUND_VOLUME;
  }
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 100) {
    return DEFAULT_SOUND_VOLUME;
  }
  return rounded;
}

/** Validates and normalizes persisted sound settings. */
export function normalizeSoundSettings(value: unknown): SoundSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultSoundSettings, events: allEventsEnabled() };
  }
  const record = value as Record<string, unknown>;
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : defaultSoundSettings.enabled,
    volume: normalizeVolume(record.volume),
    events: normalizeEventFlags(record.events),
  };
}

/** Validates and normalizes persisted OS notification settings. */
export function normalizeOsNotificationSettings(
  value: unknown,
): OsNotificationSettings {
  if (typeof value !== "object" || value === null) {
    return { ...defaultOsNotificationSettings, events: allEventsEnabled() };
  }
  const record = value as Record<string, unknown>;
  return {
    enabled:
      typeof record.enabled === "boolean"
        ? record.enabled
        : defaultOsNotificationSettings.enabled,
    events: normalizeEventFlags(record.events),
  };
}
