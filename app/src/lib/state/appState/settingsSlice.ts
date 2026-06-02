import type {
  AppCommandId,
  AppDomainState,
  AppProviderSettings,
  AppSettingsState,
  ChatProviderId,
  CommandBindingOverrides,
  DebugProviderSettings,
  ExternalFilesSettings,
  GlmProviderSettings,
  ProviderModelCatalog,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import {
  defaultAppProviderSettings,
  normalizeAppProviderSettings,
} from "../../ai/providers/appProviderSettings";
import { normalizeDebugProviderSettings } from "../../ai/providers/debugProviderSettings";
import {
  normalizeGlmProviderSettings,
  syncGlmProviderSettingsWithCatalog,
} from "../../ai/providers/glmProviderSettings";
import {
  defaultProviderModelCatalogs,
  getProviderModelCatalog,
  normalizeProviderModelCatalog,
  normalizeProviderModelCatalogs,
} from "../../ai/providers/providerModelCatalog";
import {
  normalizeCommandBindingOverrides,
} from "../../commands/commandBindings";
import { setCommandBindingOverrides } from "../../commands/registry";

const defaultExternalFilesSettings: ExternalFilesSettings = {
  watchExternalChanges: true,
  autoReloadCleanFiles: true,
  checkOnWindowFocus: true,
  checkOnTabActivate: true,
};

export const defaultSettings: AppSettingsState = {
  statusBarVisible: true,
  externalFiles: defaultExternalFilesSettings,
  decoratePlaintextSymbols: true,
  hideActivityRailWhenNotepadOnly: true,
  commandBindingOverrides: {},
  providerSettings: defaultAppProviderSettings,
  providerModelCatalogs: defaultProviderModelCatalogs,
  glmApiKey: "",
};

type SettingsUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

export function createSettingsSlice(update: SettingsUpdate) {
  function setProviderApiKey(providerId: ChatProviderId, apiKey: string) {
    if (providerId !== "glm") {
      return;
    }
    update((state) => ({
      ...state,
      settings: {
        ...state.settings,
        glmApiKey: apiKey,
      },
    }));
  }

  return {
    setDebugProviderSettings(debugProvider: DebugProviderSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            debug: normalizeDebugProviderSettings(debugProvider),
          },
        },
      }));
    },
    updateDebugProviderSettings(patch: Partial<DebugProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            debug: normalizeDebugProviderSettings({
              ...state.settings.providerSettings.debug,
              ...patch,
            }),
          },
        },
      }));
    },
    setGlmProviderSettings(glmProvider: GlmProviderSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            glm: normalizeGlmProviderSettings(glmProvider, state.settings.providerModelCatalogs),
          },
        },
      }));
    },
    updateGlmProviderSettings(patch: Partial<GlmProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            glm: normalizeGlmProviderSettings(
              {
                ...state.settings.providerSettings.glm,
                ...patch,
              },
              state.settings.providerModelCatalogs,
            ),
          },
        },
      }));
    },
    setProviderModelCatalogs(providerModelCatalogs: ProviderModelCatalogs) {
      update((state) => {
        const normalizedCatalogs = normalizeProviderModelCatalogs(providerModelCatalogs, {
          glmModelId: state.settings.providerSettings.glm.modelId,
        });
        return {
          ...state,
          settings: {
            ...state.settings,
            providerModelCatalogs: normalizedCatalogs,
            providerSettings: {
              ...state.settings.providerSettings,
              glm: syncGlmProviderSettingsWithCatalog(
                state.settings.providerSettings.glm,
                normalizedCatalogs,
              ),
            },
          },
        };
      });
    },
    updateProviderModelCatalog(providerId: ChatProviderId, patch: Partial<ProviderModelCatalog>) {
      update((state) => {
        const currentCatalog = getProviderModelCatalog(
          state.settings.providerModelCatalogs,
          providerId,
        );
        const normalizedCatalog = normalizeProviderModelCatalog(providerId, {
          ...currentCatalog,
          ...patch,
        });
        const providerModelCatalogs = normalizeProviderModelCatalogs({
          ...state.settings.providerModelCatalogs,
          [providerId]: normalizedCatalog,
        });
        return {
          ...state,
          settings: {
            ...state.settings,
            providerModelCatalogs,
            providerSettings: {
              ...state.settings.providerSettings,
              glm:
                providerId === "glm"
                  ? syncGlmProviderSettingsWithCatalog(
                      state.settings.providerSettings.glm,
                      providerModelCatalogs,
                    )
                  : state.settings.providerSettings.glm,
            },
          },
        };
      });
    },
    setProviderApiKey,
    setGlmApiKey(glmApiKey: string) {
      setProviderApiKey("glm", glmApiKey);
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
      hideActivityRailWhenNotepadOnly?: boolean;
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
        if (partial.providerSettings?.debug) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              providerSettings: {
                ...next.settings.providerSettings,
                debug: normalizeDebugProviderSettings(partial.providerSettings.debug),
              },
            },
          };
        }

        const glmModelId =
          partial.providerSettings?.glm?.modelId ?? next.settings.providerSettings.glm.modelId;
        const providerModelCatalogs = partial.providerModelCatalogs
          ? normalizeProviderModelCatalogs(partial.providerModelCatalogs, { glmModelId })
          : normalizeProviderModelCatalogs(next.settings.providerModelCatalogs, { glmModelId });

        if (partial.providerSettings?.glm || partial.providerModelCatalogs) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              providerModelCatalogs,
              providerSettings: {
                ...next.settings.providerSettings,
                glm: normalizeGlmProviderSettings(
                  partial.providerSettings?.glm ?? next.settings.providerSettings.glm,
                  providerModelCatalogs,
                ),
              },
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
