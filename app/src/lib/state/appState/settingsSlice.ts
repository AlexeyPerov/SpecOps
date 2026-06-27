import type {
  AppCommandId,
  AppProviderSettings,
  AppSettingsState,
  ChatHttpSettings,
  CommandBindingOverrides,
  ExternalFilesSettings,
  FontSettings,
  LogSettings,
  OpencodeHealthState,
  OpencodeSettings,
  OsNotificationSettings,
  ProviderModelCatalogs,
  SoundSettings,
} from "../../domain/contracts";
import {
  defaultAppProviderSettings,
  normalizeAppProviderSettings,
} from "../../ai/providers/appProviderSettings";
import { defaultChatModesSettings, normalizeChatModesSettings } from "../../ai/modes/chatModesSettings";
import {
  defaultProviderModelCatalogs,
  normalizeProviderModelCatalogs,
} from "../../ai/providers/providerModelCatalog";
import {
  normalizeCommandBindingOverrides,
} from "../../commands/commandBindings";
import { setCommandBindingOverrides } from "../../commands/commandBindingRuntime";
import { DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES } from "../../services/binaryFileOpen";
import { DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES } from "../../services/largeFileOpen";
import { defaultLogSettings, normalizeLogSettings } from "../../services/logSettings";
import {
  defaultFontSettings,
  normalizeFontSettings,
} from "../../services/fontSettings";
import {
  defaultOsNotificationSettings,
  defaultSoundSettings,
  normalizeOsNotificationSettings,
  normalizeSoundSettings,
} from "../../services/notificationSettings";
import { createChatModesSettingsSlice } from "./chatModesSettingsSlice";
import { createFontSettingsSlice } from "./fontSettingsSlice";
import { createLogSettingsSlice, type SettingsUpdate } from "./logSettingsSlice";
import { createNotificationSettingsSlice } from "./notificationSettingsSlice";
import { createProviderSettingsSlice } from "./providerSettingsSlice";
import { defaultOpencodeSettings, normalizeOpencodeSettings } from "../../services/opencodeSettings";
import {
  defaultChatHttpSettings,
  normalizeChatHttpSettings,
} from "../../services/chatHttpSettings";

const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
  maxBinaryOpenAsTextBytes: DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES,
  maxOpenWithoutConfirmBytes: DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES,
};

export const defaultSettings: AppSettingsState = {
  statusBarVisible: true,
  externalFiles: defaultExternalFilesSettings,
  decoratePlaintextSymbols: true,
  opencode: defaultOpencodeSettings,
  chatHttp: defaultChatHttpSettings,
  opencodeHealth: {
    status: "unknown",
    source: null,
    checkedAt: null,
    lastErrorMessage: null,
  },
  commandBindingOverrides: {},
  logSettings: defaultLogSettings,
  chatModes: defaultChatModesSettings,
  providerSettings: defaultAppProviderSettings,
  providerModelCatalogs: defaultProviderModelCatalogs,
  fontSettings: { ...defaultFontSettings },
  soundSettings: { ...defaultSoundSettings },
  osNotificationSettings: { ...defaultOsNotificationSettings },
  providerApiKeys: {},
};

function createGeneralSettingsSlice(update: SettingsUpdate) {
  return {
    setChatHttpEnabled(enabled: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatHttp: normalizeChatHttpSettings({
            ...state.settings.chatHttp,
            enabled,
          }),
        },
      }));
    },
    setCommandBindingOverrides(commandBindingOverrides: CommandBindingOverrides) {
      const normalized = normalizeCommandBindingOverrides(commandBindingOverrides);
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          commandBindingOverrides: normalized,
        },
      }));
      setCommandBindingOverrides(normalized);
    },
    updateCommandBinding(commandId: AppCommandId, binding: Partial<CommandBindingOverrides[AppCommandId]>) {
      update((state) => {
        const current = state.settings.commandBindingOverrides[commandId] ?? {};
        const nextOverride = { ...current, ...binding };
        const commandBindingOverrides = {
          ...state.settings.commandBindingOverrides,
          [commandId]: nextOverride,
        };
        setCommandBindingOverrides(commandBindingOverrides);
        return {
          ...state,
          settings: {
            ...state.settings,
            commandBindingOverrides,
          },
        };
      });
    },
    resetCommandBinding(commandId: AppCommandId) {
      update((state) => {
        const { [commandId]: _removed, ...commandBindingOverrides } =
          state.settings.commandBindingOverrides;
        setCommandBindingOverrides(commandBindingOverrides);
        return {
          ...state,
          settings: {
            ...state.settings,
            commandBindingOverrides,
          },
        };
      });
    },
    applyPersistedSettings(partial: {
      wrapLines?: boolean;
      zoomPercent?: number;
      externalFiles?: ExternalFilesSettings;
      decoratePlaintextSymbols?: boolean;
      opencode?: Partial<OpencodeSettings>;
      chatHttp?: Partial<ChatHttpSettings>;
      opencodeHealth?: Partial<OpencodeHealthState>;
      logSettings?: Partial<LogSettings>;
      chatModes?: Partial<AppSettingsState["chatModes"]>;
      providerSettings?: Partial<AppProviderSettings>;
      providerModelCatalogs?: ProviderModelCatalogs;
      commandBindingOverrides?: CommandBindingOverrides;
      fontSettings?: Partial<FontSettings>;
      soundSettings?: Partial<SoundSettings>;
      osNotificationSettings?: Partial<OsNotificationSettings>;
    }) {
      update((state) => {
        let next = state;
        if (typeof partial.wrapLines === "boolean" && partial.wrapLines !== next.editor.wrapLines) {
          next = {
            ...next,
            editor: { ...next.editor, wrapLines: partial.wrapLines },
          };
        }
        if (typeof partial.zoomPercent === "number") {
          next = {
            ...next,
            editor: { ...next.editor, zoomPercent: partial.zoomPercent },
          };
        }
        if (partial.externalFiles) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              externalFiles: partial.externalFiles,
            },
          };
        }
        if (typeof partial.decoratePlaintextSymbols === "boolean") {
          next = {
            ...next,
            settings: {
              ...next.settings,
              decoratePlaintextSymbols: partial.decoratePlaintextSymbols,
            },
          };
        }
        if (partial.opencode) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              opencode: normalizeOpencodeSettings({
                ...next.settings.opencode,
                ...partial.opencode,
              }),
            },
          };
        }
        if (partial.chatHttp) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              chatHttp: normalizeChatHttpSettings({
                ...next.settings.chatHttp,
                ...partial.chatHttp,
              }),
            },
          };
        }
        if (partial.opencodeHealth) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              opencodeHealth: {
                ...next.settings.opencodeHealth,
                ...partial.opencodeHealth,
              },
            },
          };
        }
        if (partial.logSettings) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              logSettings: normalizeLogSettings({
                ...next.settings.logSettings,
                ...partial.logSettings,
              }),
            },
          };
        }
        if (partial.chatModes) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              chatModes: normalizeChatModesSettings({
                ...next.settings.chatModes,
                ...partial.chatModes,
              }),
            },
          };
        }
        const providerModelCatalogs = partial.providerModelCatalogs
          ? normalizeProviderModelCatalogs(partial.providerModelCatalogs)
          : normalizeProviderModelCatalogs(next.settings.providerModelCatalogs);

        if (partial.providerSettings) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              providerModelCatalogs,
              providerSettings: normalizeAppProviderSettings({
                ...next.settings.providerSettings,
                ...partial.providerSettings,
              }, providerModelCatalogs),
            },
          };
        } else if (partial.providerModelCatalogs) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              providerModelCatalogs,
            },
          };
        }

        if (partial.commandBindingOverrides) {
          const commandBindingOverrides = normalizeCommandBindingOverrides(
            partial.commandBindingOverrides,
          );
          next = {
            ...next,
            settings: {
              ...next.settings,
              commandBindingOverrides,
            },
          };
          setCommandBindingOverrides(commandBindingOverrides);
        }

        if (partial.fontSettings) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              fontSettings: normalizeFontSettings({
                ...next.settings.fontSettings,
                ...partial.fontSettings,
              }),
            },
          };
        }

        if (partial.soundSettings) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              soundSettings: normalizeSoundSettings({
                ...next.settings.soundSettings,
                ...partial.soundSettings,
              }),
            },
          };
        }

        if (partial.osNotificationSettings) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              osNotificationSettings: normalizeOsNotificationSettings({
                ...next.settings.osNotificationSettings,
                ...partial.osNotificationSettings,
              }),
            },
          };
        }

        return next;
      });
    },
  };
}

export function createSettingsSlice(update: SettingsUpdate) {
  return {
    ...createGeneralSettingsSlice(update),
    ...createProviderSettingsSlice(update),
    ...createChatModesSettingsSlice(update),
    ...createLogSettingsSlice(update),
    ...createFontSettingsSlice(update),
    ...createNotificationSettingsSlice(update),
  };
}
