import type { AppDomainState, LogSettings } from "../../domain/contracts";
import { normalizeLogSettings } from "../../services/logSettings";

export type SettingsUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

export function createLogSettingsSlice(update: SettingsUpdate) {
  return {
    updateLogSettings(patch: Partial<LogSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          logSettings: normalizeLogSettings({
            ...state.settings.logSettings,
            ...patch,
          }),
        },
      }));
    },
  };
}
