import type { ChatProviderId, ProviderModelCatalog, ProviderModelCatalogs } from "../../domain/contracts";

const PROVIDER_IDS: readonly ChatProviderId[] = ["http", "debug-chat", "debug-workspace"];

export const defaultProviderModelCatalogs: ProviderModelCatalogs = {
  http: {
    modelIds: ["gpt-4o-mini"],
    defaultModelId: "gpt-4o-mini",
  },
  "debug-chat": {
    modelIds: ["debug-simulator"],
    defaultModelId: "debug-simulator",
  },
  "debug-workspace": {
    modelIds: ["debug-simulator"],
    defaultModelId: "debug-simulator",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dedupeModelIds(modelIds: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const modelId of modelIds) {
    if (seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    next.push(modelId);
  }
  return next;
}

/** Parses newline- or comma-separated model list input from Settings UI. */
export function parseModelListInput(raw: string): string[] {
  return dedupeModelIds(
    raw
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function formatModelListForInput(modelIds: string[]): string {
  return modelIds.join("\n");
}

function normalizeModelIds(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const parsed = dedupeModelIds(
    value
      .map((entry) => normalizeModelId(entry))
      .filter((entry): entry is string => entry !== null),
  );

  return parsed.length > 0 ? parsed : [...fallback];
}

function resolveDefaultModelId(
  modelIds: string[],
  requestedDefault: unknown,
  fallbackDefault: string,
): string {
  const requested = normalizeModelId(requestedDefault);
  if (requested && modelIds.includes(requested)) {
    return requested;
  }
  if (modelIds.includes(fallbackDefault)) {
    return fallbackDefault;
  }
  return modelIds[0] ?? fallbackDefault;
}

export function normalizeProviderModelCatalog(
  providerId: ChatProviderId,
  input?: Partial<ProviderModelCatalog> | unknown,
): ProviderModelCatalog {
  const defaults = defaultProviderModelCatalogs[providerId] ?? {
    modelIds: [],
    defaultModelId: "",
  };
  const source = isRecord(input) ? input : {};

  const modelIds = normalizeModelIds(source.modelIds, defaults.modelIds);
  const defaultModelId = resolveDefaultModelId(
    modelIds,
    source.defaultModelId,
    defaults.defaultModelId,
  );

  return { modelIds, defaultModelId };
}

function resolveLegacyDebugCatalog(source: Record<string, unknown>): unknown {
  if (isRecord(source.debug)) {
    return source.debug;
  }
  return undefined;
}

/** Validates provider model catalogs on load/save. */
export function normalizeProviderModelCatalogs(
  input?: Partial<ProviderModelCatalogs> | unknown,
): ProviderModelCatalogs {
  const source = isRecord(input) ? input : {};
  const legacyDebugCatalog = resolveLegacyDebugCatalog(source);

  const catalogs = {} as ProviderModelCatalogs;
  for (const providerId of PROVIDER_IDS) {
    const scopedSource =
      source[providerId] ??
      (providerId === "debug-chat" || providerId === "debug-workspace"
        ? legacyDebugCatalog
        : undefined);
    catalogs[providerId] = normalizeProviderModelCatalog(providerId, scopedSource);
  }

  return catalogs;
}

export function getProviderModelCatalog(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
): ProviderModelCatalog {
  return normalizeProviderModelCatalog(providerId, catalogs[providerId]);
}

export function isModelInProviderCatalog(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
  modelId: string,
): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  if (!normalizedModelId) {
    return false;
  }
  return getProviderModelCatalog(catalogs, providerId).modelIds.includes(normalizedModelId);
}

export function getProviderDefaultModelId(
  catalogs: ProviderModelCatalogs,
  providerId: ChatProviderId,
): string {
  return getProviderModelCatalog(catalogs, providerId).defaultModelId;
}
