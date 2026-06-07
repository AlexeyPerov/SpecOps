import type {
  AppCommandId,
  AppDomainState,
  AppProviderSettings,
  AppSettingsState,
  BuiltinChatModeId,
  ChatModeContextToggles,
  ChatProviderId,
  CommandBindingOverrides,
  CustomChatModeDefinition,
  DebugProviderSettings,
  ExternalFilesSettings,
  HttpConnection,
  HttpConnectionSettings,
  LogSettings,
  ProviderModelCatalog,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import {
  defaultAppProviderSettings,
  normalizeAppProviderSettings,
} from "../../ai/providers/appProviderSettings";
import {
  createCustomChatModeId,
  defaultChatModesSettings,
  normalizeChatModesSettings,
  normalizeCustomChatModeDefinition,
} from "../../ai/modes/chatModesSettings";
import { normalizeDebugProviderSettings } from "../../ai/providers/debugProviderSettings";
import {
  defaultHttpConnection,
  defaultHttpConnectionSettings,
  DEFAULT_HTTP_CONNECTION_ID,
  normalizeHttpConnection,
  normalizeHttpConnections,
  normalizeHttpConnectionSettings,
} from "../../ai/providers/httpConnectionSettings";
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
import { DEFAULT_MAX_BINARY_OPEN_AS_TEXT_BYTES } from "../../services/binaryFileOpen";
import { DEFAULT_MAX_OPEN_WITHOUT_CONFIRM_BYTES } from "../../services/largeFileOpen";
import { defaultLogSettings, normalizeLogSettings } from "../../services/logSettings";

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

type SettingsUpdate = (mutator: (state: AppDomainState) => AppDomainState) => void;

export function createSettingsSlice(update: SettingsUpdate) {
  function setConnectionApiKey(connectionId: string, apiKey: string) {
    const normalized = apiKey.trim();
    update((state) => {
      const providerApiKeys = { ...state.settings.providerApiKeys };
      if (normalized.length === 0) {
        delete providerApiKeys[connectionId];
      } else {
        providerApiKeys[connectionId] = normalized;
      }
      return {
        ...state,
        settings: {
          ...state.settings,
          providerApiKeys,
        },
      };
    });
  }

  return {
    setDebugChatProviderSettings(debugProvider: DebugProviderSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            debugChat: normalizeDebugProviderSettings(debugProvider),
          },
        },
      }));
    },
    updateDebugChatProviderSettings(patch: Partial<DebugProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            debugChat: normalizeDebugProviderSettings({
              ...state.settings.providerSettings.debugChat,
              ...patch,
            }),
          },
        },
      }));
    },
    setDebugWorkspaceProviderSettings(debugProvider: DebugProviderSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            debugWorkspace: normalizeDebugProviderSettings(debugProvider),
          },
        },
      }));
    },
    updateDebugWorkspaceProviderSettings(patch: Partial<DebugProviderSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            debugWorkspace: normalizeDebugProviderSettings({
              ...state.settings.providerSettings.debugWorkspace,
              ...patch,
            }),
          },
        },
      }));
    },
    setHttpConnectionSettings(httpConnection: HttpConnectionSettings) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            httpConnections: [
              normalizeHttpConnection({
                ...(state.settings.providerSettings.httpConnections?.[0] ?? defaultHttpConnection),
                ...httpConnection,
              }),
            ],
            defaultConnectionId:
              state.settings.providerSettings.defaultConnectionId ?? DEFAULT_HTTP_CONNECTION_ID,
            http: normalizeHttpConnectionSettings(httpConnection),
          },
        },
      }));
    },
    updateHttpConnectionSettings(patch: Partial<HttpConnectionSettings>) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          providerSettings: {
            ...state.settings.providerSettings,
            httpConnections: [
              normalizeHttpConnection({
                ...(state.settings.providerSettings.httpConnections?.[0] ?? defaultHttpConnection),
                ...patch,
              }),
            ],
            http: normalizeHttpConnectionSettings({
              ...state.settings.providerSettings.http,
              ...patch,
            }),
          },
        },
      }));
    },
    addHttpConnection(connection: Partial<HttpConnection>) {
      update((state) => {
        const normalized = normalizeHttpConnection(connection);
        const existing = state.settings.providerSettings.httpConnections ?? [];
        const withoutSameId = existing.filter((item) => item.id !== normalized.id);
        const httpConnections = normalizeHttpConnections([...withoutSameId, normalized]);
        return {
          ...state,
          settings: {
            ...state.settings,
            providerSettings: {
              ...state.settings.providerSettings,
              httpConnections,
              defaultConnectionId:
                state.settings.providerSettings.defaultConnectionId ??
                httpConnections[0]?.id ??
                DEFAULT_HTTP_CONNECTION_ID,
              http: normalizeHttpConnectionSettings(httpConnections[0] ?? defaultHttpConnection),
            },
          },
        };
      });
    },
    updateHttpConnection(connectionId: string, patch: Partial<HttpConnection>) {
      const normalizedId = connectionId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => {
        const existing = state.settings.providerSettings.httpConnections ?? [];
        const next = existing.map((connection) =>
          connection.id === normalizedId ? normalizeHttpConnection({ ...connection, ...patch }) : connection,
        );
        const httpConnections = normalizeHttpConnections(next);
        return {
          ...state,
          settings: {
            ...state.settings,
            providerSettings: {
              ...state.settings.providerSettings,
              httpConnections,
              http: normalizeHttpConnectionSettings(httpConnections[0] ?? defaultHttpConnection),
            },
          },
        };
      });
    },
    removeHttpConnection(connectionId: string) {
      const normalizedId = connectionId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => {
        const existing = state.settings.providerSettings.httpConnections ?? [];
        const filtered = existing.filter((connection) => connection.id !== normalizedId);
        const httpConnections = filtered.length > 0 ? normalizeHttpConnections(filtered) : [];
        const providerApiKeys = { ...state.settings.providerApiKeys };
        delete providerApiKeys[normalizedId];
        const nextDefaultId =
          state.settings.providerSettings.defaultConnectionId === normalizedId
            ? httpConnections[0]?.id
            : state.settings.providerSettings.defaultConnectionId;
        return {
          ...state,
          settings: {
            ...state.settings,
            providerApiKeys,
            providerSettings: {
              ...state.settings.providerSettings,
              httpConnections,
              defaultConnectionId: nextDefaultId,
              http: normalizeHttpConnectionSettings(httpConnections[0] ?? defaultHttpConnectionSettings),
            },
          },
        };
      });
    },
    setDefaultConnectionId(connectionId: string | undefined) {
      const normalized = connectionId?.trim();
      update((state) => {
        const existing = state.settings.providerSettings.httpConnections ?? [];
        const hasMatch = normalized ? existing.some((connection) => connection.id === normalized) : false;
        return {
          ...state,
          settings: {
            ...state.settings,
            providerSettings: {
              ...state.settings.providerSettings,
              defaultConnectionId: hasMatch ? normalized : existing[0]?.id,
            },
          },
        };
      });
    },
    setProviderModelCatalogs(providerModelCatalogs: ProviderModelCatalogs) {
      update((state) => {
        const normalizedCatalogs = normalizeProviderModelCatalogs(providerModelCatalogs);
        return {
          ...state,
          settings: {
            ...state.settings,
            providerModelCatalogs: normalizedCatalogs,
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
          },
        };
      });
    },
    setConnectionApiKey,
    setProviderApiKey(providerId: string, apiKey: string) {
      // Temporary compatibility for legacy call sites in milestones prior to full M4 migration.
      setConnectionApiKey(providerId, apiKey);
    },
    setGlmApiKey(_glmApiKey: string) {},
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
    setChatModesSettings(chatModes: AppSettingsState["chatModes"]) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings(chatModes),
        },
      }));
    },
    setRawEnabled(rawEnabled: boolean) {
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings({
            ...state.settings.chatModes,
            rawEnabled,
          }),
        },
      }));
    },
    updateBuiltinModeToggles(
      modeId: BuiltinChatModeId,
      patch: Partial<ChatModeContextToggles>,
    ) {
      update((state) => {
        const current = state.settings.chatModes.builtinToggles[modeId];
        return {
          ...state,
          settings: {
            ...state.settings,
            chatModes: normalizeChatModesSettings({
              ...state.settings.chatModes,
              builtinToggles: {
                ...state.settings.chatModes.builtinToggles,
                [modeId]: {
                  ...current,
                  ...patch,
                },
              },
            }),
          },
        };
      });
    },
    addCustomChatMode(mode: Partial<CustomChatModeDefinition>) {
      update((state) => {
        const normalized = normalizeCustomChatModeDefinition(mode);
        const withoutDuplicate = state.settings.chatModes.customModes.filter(
          (entry) => entry.id !== normalized.id,
        );
        return {
          ...state,
          settings: {
            ...state.settings,
            chatModes: normalizeChatModesSettings({
              ...state.settings.chatModes,
              customModes: [...withoutDuplicate, normalized],
            }),
          },
        };
      });
    },
    updateCustomChatMode(modeId: string, patch: Partial<CustomChatModeDefinition>) {
      const normalizedId = modeId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => {
        const existing = state.settings.chatModes.customModes.find((mode) => mode.id === normalizedId);
        if (!existing) {
          return state;
        }
        const customModes = state.settings.chatModes.customModes.map((mode) =>
          mode.id === normalizedId
            ? normalizeCustomChatModeDefinition({ ...mode, ...patch, id: normalizedId })
            : mode,
        );
        return {
          ...state,
          settings: {
            ...state.settings,
            chatModes: normalizeChatModesSettings({
              ...state.settings.chatModes,
              customModes,
            }),
          },
        };
      });
    },
    removeCustomChatMode(modeId: string) {
      const normalizedId = modeId.trim();
      if (!normalizedId) {
        return;
      }
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings({
            ...state.settings.chatModes,
            customModes: state.settings.chatModes.customModes.filter(
              (mode) => mode.id !== normalizedId,
            ),
          }),
        },
      }));
    },
    createCustomChatModeDraft(name = "Untitled mode"): string {
      const id = createCustomChatModeId();
      update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          chatModes: normalizeChatModesSettings({
            ...state.settings.chatModes,
            customModes: [
              ...state.settings.chatModes.customModes,
              normalizeCustomChatModeDefinition({ id, name, enabled: false }),
            ],
          }),
        },
      }));
      return id;
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
