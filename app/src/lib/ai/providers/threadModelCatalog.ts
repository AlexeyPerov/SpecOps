import type {
  AppProviderSettings,
  ChatProviderId,
  ChatThreadSnapshot,
  ProviderModelCatalog,
  ProviderModelCatalogs,
} from "../../domain/contracts";
import { resolveHttpConnection } from "./httpConnectionSettings";
import { resolveEffectiveThreadModelId } from "./modelValidation";
import {
  getProviderDefaultModelId,
  getProviderModelCatalog,
  normalizeProviderModelCatalogs,
} from "./providerModelCatalog";

export interface ThreadModelCatalogContext {
  providerSettings?: AppProviderSettings;
  connectionId?: string;
}

/** Resolves the model catalog for a thread provider, preferring HTTP connection catalogs. */
export function resolveThreadModelCatalog(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
  context?: ThreadModelCatalogContext,
): ProviderModelCatalog {
  const normalizedCatalogs = normalizeProviderModelCatalogs(catalogs);

  if (providerId === "http" && context?.providerSettings) {
    const resolved = resolveHttpConnection(
      context.providerSettings,
      {},
      context.connectionId,
    );
    if (resolved) {
      return resolved.connection.modelCatalog;
    }
  }

  return getProviderModelCatalog(normalizedCatalogs, providerId);
}

export function isModelInThreadCatalog(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
  modelId: string,
  context?: ThreadModelCatalogContext,
): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return false;
  }
  return resolveThreadModelCatalog(catalogs, providerId, context).modelIds.includes(trimmed);
}

export function resolveThreadCatalogDefaultModelId(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
  context?: ThreadModelCatalogContext,
): string {
  const catalog = resolveThreadModelCatalog(catalogs, providerId, context);
  const defaultModelId = catalog.defaultModelId.trim();
  if (defaultModelId.length > 0 && catalog.modelIds.includes(defaultModelId)) {
    return defaultModelId;
  }
  if (catalog.modelIds.length > 0) {
    return catalog.modelIds[0]!;
  }
  return getProviderDefaultModelId(normalizeProviderModelCatalogs(catalogs), providerId);
}

export function resolveComposerConnectionId(
  providerId: ChatProviderId,
  providerSettings: AppProviderSettings,
  connectionId?: string,
): string | undefined {
  const trimmed = connectionId?.trim();
  if (trimmed) {
    return trimmed;
  }
  if (providerId !== "http") {
    return undefined;
  }
  const preferred = providerSettings.defaultConnectionId?.trim();
  if (preferred) {
    const resolved = resolveHttpConnection(providerSettings, {}, preferred);
    if (resolved) {
      return resolved.connection.id;
    }
  }
  return resolveHttpConnection(providerSettings, {})?.connection.id;
}

/** Resolves the model shown/sent in the composer, including before a thread exists. */
export function resolveComposerModelId(params: {
  thread: ChatThreadSnapshot | null;
  providerId: ChatProviderId;
  providerSettings: AppProviderSettings;
  providerModelCatalogs: ProviderModelCatalogs;
  connectionId?: string;
}): string {
  const normalizedCatalogs = normalizeProviderModelCatalogs(params.providerModelCatalogs);
  const catalogContext: ThreadModelCatalogContext = {
    providerSettings: params.providerSettings,
    connectionId: resolveComposerConnectionId(
      params.providerId,
      params.providerSettings,
      params.connectionId ?? params.thread?.metadata.connectionId,
    ),
  };
  if (params.thread) {
    return resolveEffectiveThreadModelId(params.thread, normalizedCatalogs, catalogContext);
  }
  return resolveThreadCatalogDefaultModelId(normalizedCatalogs, params.providerId, catalogContext);
}
