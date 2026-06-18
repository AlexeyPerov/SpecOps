import type {
  AppDomainState,
  NotificationEventId,
  OsNotificationSettings,
  SoundSettings,
} from "../../domain/contracts";
import {
  normalizeOsNotificationSettings,
  normalizeSoundSettings,
} from "../../services/notificationSettings";
import type { SettingsUpdate } from "./logSettingsSlice";

export function createNotificationSettingsSlice(update: SettingsUpdate) {
  return {
    updateSoundSettings(patch: Partial<SoundSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          soundSettings: normalizeSoundSettings({
            ...state.settings.soundSettings,
            ...patch,
          }),
        },
      }));
    },
    setSoundEnabled(enabled: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          soundSettings: normalizeSoundSettings({
            ...state.settings.soundSettings,
            enabled,
          }),
        },
      }));
    },
    setSoundVolume(volume: number) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          soundSettings: normalizeSoundSettings({
            ...state.settings.soundSettings,
            volume,
          }),
        },
      }));
    },
    toggleSoundEvent(event: NotificationEventId, enabled: boolean) {
      update((state) => {
        const events = {
          ...state.settings.soundSettings.events,
          [event]: enabled,
        };
        return {
          ...state,
          settings: {
            ...state.settings,
            soundSettings: normalizeSoundSettings({
              ...state.settings.soundSettings,
              events,
            }),
          },
        };
      });
    },
    updateOsNotificationSettings(patch: Partial<OsNotificationSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          osNotificationSettings: normalizeOsNotificationSettings({
            ...state.settings.osNotificationSettings,
            ...patch,
          }),
        },
      }));
    },
    setOsNotificationsEnabled(enabled: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          osNotificationSettings: normalizeOsNotificationSettings({
            ...state.settings.osNotificationSettings,
            enabled,
          }),
        },
      }));
    },
    toggleOsNotificationEvent(event: NotificationEventId, enabled: boolean) {
      update((state) => {
        const events = {
          ...state.settings.osNotificationSettings.events,
          [event]: enabled,
        };
        return {
          ...state,
          settings: {
            ...state.settings,
            osNotificationSettings: normalizeOsNotificationSettings({
              ...state.settings.osNotificationSettings,
              events,
            }),
          },
        };
      });
    },
  };
}
