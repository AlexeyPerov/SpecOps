import type {
  AppCommandId,
  AppProviderSettings,
  AppSettingsState,
  CommandBindingOverrides,
  ExternalFilesSettings,
  LogSettings,
  ProviderModelCatalogs,
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
import { setCommandBindingOverrides } from "../../commands/registry";
import { DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES } from "../../services/binaryFileOpen";
import { DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES } from "../../services/largeFileOpen";
import { defaultLogSettings, normalizeLogSettings } from "../../services/logSettings";
import { createChatModesSettingsSlice } from "./chatModesSettingsSlice";
import { createLogSettingsSlice, type SettingsUpdate } from "./logSettingsSlice";
import { createProviderSettingsSlice } from "./providerSettingsSlice";

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
  hideActivityRailWhenNotepadOnly: true,
  commandBindingOverrides: {},
  logSettings: defaultLogSettings,
  chatModes: defaultChatModesSettings,
  providerSettings: defaultAppProviderSettings,
  providerModelCatalogs: defaultProviderModelCatalogs,
  providerApiKeys: {},
};

function createGeneralSettingsSlice(update: SettingsUpdate) {
  return {
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
      hideActivityRailWhenNotepadOnly?: boolean;
      logSettings?: Partial<LogSettings>;
      chatModes?: Partial<AppSettingsState["chatModes"]>;
      providerSettings?: Partial<AppProviderSettings>;
      providerModelCatalogs?: ProviderModelCatalogs;
      commandBindingOverrides?: CommandBindingOverrides;
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
        if (typeof partial.hideActivityRailWhenNotepadOnly === "boolean") {
          next = {
            ...next,
            settings: {
              ...next.settings,
              hideActivityRailWhenNotepadOnly: partial.hideActivityRailWhenNotepadOnly,
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
  };
}
