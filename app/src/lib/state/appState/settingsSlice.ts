import type {
  AppDomainState,
  AppSettingsState,
  ChatProviderId,
  DebugProviderSettings,
  ExternalFilesSettings,
  GlmProviderSettings,
  ProviderModelCatalog,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import {
  defaultDebugProviderSettings,
  normalizeDebugProviderSettings,
} from "../../ai/providers/debugProviderSettings";
import {
  defaultGlmProviderSettings,
  normalizeGlmProviderSettings,
  syncGlmProviderSettingsWithCatalog,
} from "../../ai/providers/glmProviderSettings";
import {
  defaultProviderModelCatalogs,
  getProviderModelCatalog,
  normalizeProviderModelCatalog,
  normalizeProviderModelCatalogs,
} from "../../ai/providers/providerModelCatalog";

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
  debugProvider: defaultDebugProviderSettings,
  glmProvider: defaultGlmProviderSettings,
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
          debugProvider: normalizeDebugProviderSettings(debugProvider),
        },
      }));
    },
    updateDebugProviderSettings(patch: Partial<DebugProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          debugProvider: normalizeDebugProviderSettings({
            ...state.settings.debugProvider,
            ...patch,
          }),
        },
      }));
    },
    setGlmProviderSettings(glmProvider: GlmProviderSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          glmProvider: normalizeGlmProviderSettings(
            glmProvider,
            state.settings.providerModelCatalogs,
          ),
        },
      }));
    },
    updateGlmProviderSettings(patch: Partial<GlmProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          glmProvider: normalizeGlmProviderSettings(
            {
              ...state.settings.glmProvider,
              ...patch,
            },
            state.settings.providerModelCatalogs,
          ),
        },
      }));
    },
    setProviderModelCatalogs(providerModelCatalogs: ProviderModelCatalogs) {
      update((state) => {
        const normalizedCatalogs = normalizeProviderModelCatalogs(providerModelCatalogs, {
          glmModelId: state.settings.glmProvider.modelId,
        });
        return {
          ...state,
          settings: {
            ...state.settings,
            providerModelCatalogs: normalizedCatalogs,
            glmProvider: syncGlmProviderSettingsWithCatalog(
              state.settings.glmProvider,
              normalizedCatalogs,
            ),
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
            glmProvider:
              providerId === "glm"
                ? syncGlmProviderSettingsWithCatalog(
                    state.settings.glmProvider,
                    providerModelCatalogs,
                  )
                : state.settings.glmProvider,
          },
        };
      });
    },
    setProviderApiKey,
    setGlmApiKey(glmApiKey: string) {
      setProviderApiKey("glm", glmApiKey);
    },
    applyPersistedSettings(partial: {
      wrapLines?: boolean;
      zoomPercent?: number;
      externalFiles?: ExternalFilesSettings;
      decoratePlaintextSymbols?: boolean;
      hideActivityRailWhenNotepadOnly?: boolean;
      debugProvider?: DebugProviderSettings;
      glmProvider?: GlmProviderSettings;
      providerModelCatalogs?: ProviderModelCatalogs;
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
        if (partial.debugProvider) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              debugProvider: normalizeDebugProviderSettings(partial.debugProvider),
            },
          };
        }

        const providerModelCatalogs = partial.providerModelCatalogs
          ? normalizeProviderModelCatalogs(partial.providerModelCatalogs, {
              glmModelId: partial.glmProvider?.modelId ?? next.settings.glmProvider.modelId,
            })
          : normalizeProviderModelCatalogs(next.settings.providerModelCatalogs, {
              glmModelId: partial.glmProvider?.modelId ?? next.settings.glmProvider.modelId,
            });

        if (partial.glmProvider || partial.providerModelCatalogs) {
          next = {
            ...next,
            settings: {
              ...next.settings,
              providerModelCatalogs,
              glmProvider: normalizeGlmProviderSettings(
                partial.glmProvider ?? next.settings.glmProvider,
                providerModelCatalogs,
              ),
            },
          };
        }

        return next;
      });
    },
  };
}
