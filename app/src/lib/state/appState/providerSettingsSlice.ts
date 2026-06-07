import type {
  ChatProviderId,
  DebugProviderSettings,
  HttpConnection,
  HttpConnectionSettings,
  ProviderModelCatalog,
  ProviderModelCatalogs,
} from "../../domain/contracts";
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
  getProviderModelCatalog,
  normalizeProviderModelCatalog,
  normalizeProviderModelCatalogs,
} from "../../ai/providers/providerModelCatalog";
import type { SettingsUpdate } from "./logSettingsSlice";

export function createProviderSettingsSlice(update: SettingsUpdate) {
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
  };
}
