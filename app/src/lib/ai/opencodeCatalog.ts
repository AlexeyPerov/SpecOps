import { type OpencodeModelEntry, type OpencodeProviderEntry, type OpencodeAgentEntry } from "./backends/workspaceAgentBackend";
import { createReactiveResourceStore } from "./opencodeResourceStore";

/**
 * Per-workspace OpenCode model / provider / agent catalog (M2-era). Pull-only —
 * the settings panels read a snapshot on mount rather than subscribing. M10-T1:
 * the cache + inflight + diagnostic skeleton now lives in
 * `createReactiveResourceStore`.
 */

export type OpencodeCatalogStatus = "idle" | "loading" | "loaded" | "error";

export interface OpencodeCatalogState {
  status: OpencodeCatalogStatus;
  models: OpencodeModelEntry[];
  providers: OpencodeProviderEntry[];
  agents: OpencodeAgentEntry[];
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyCatalog: OpencodeCatalogState = {
  status: "idle",
  models: [],
  providers: [],
  agents: [],
  lastErrorMessage: null,
  loadedAt: null,
};

const store = createReactiveResourceStore<OpencodeCatalogState, string>({
  diagnosticLabel: "opencode catalog",
  diagnosticKind: "opencode.catalog.refresh",
  reactive: false,
  keyOf: (workspaceRootPath) => workspaceRootPath,
  diagnosticExtra: (workspaceRootPath) => ({ workspaceRootPath }),
  copyEmptyState: () => ({ ...emptyCatalog }),
  disabledState: () => ({ ...emptyCatalog }),
  buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
  buildErrorState: (message) => ({
    ...emptyCatalog,
    status: "error",
    models: [],
    providers: [],
    agents: [],
    lastErrorMessage: message,
    loadedAt: null,
  }),
  async fetch(backend, workspaceRootPath) {
    const [models, providers, agents] = await Promise.all([
      backend.listModels({ workspaceRootPath }),
      backend.listProviders({ workspaceRootPath }),
      backend.listAgents({ workspaceRootPath }),
    ]);
    return {
      status: "loaded",
      models,
      providers,
      agents,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
  },
});

export function getOpencodeCatalog(workspaceRootPath: string): OpencodeCatalogState {
  return store.getSnapshot(workspaceRootPath);
}

export function resetOpencodeCatalogForTests(): void {
  store.resetForTests();
}

/**
 * M10-T3 — per-workspace cache invalidation. Wired to workspace-switch / close
 * so the process-lifetime cache doesn't accumulate an entry per workspace ever
 * opened (slow leak in a long-running desktop app).
 */
export function clearOpencodeCatalog(workspaceRootPath: string): void {
  store.clear(workspaceRootPath);
}

export async function refreshOpencodeCatalog(
  workspaceRootPath: string,
): Promise<OpencodeCatalogState> {
  return store.refresh(workspaceRootPath);
}

export function listSelectableOpencodeModels(workspaceRootPath: string): OpencodeModelEntry[] {
  const catalog = getOpencodeCatalog(workspaceRootPath);
  return catalog.models;
}

export function resolveOpencodeModelFallback(
  workspaceRootPath: string,
  preferredModelId?: string | null,
): string | null {
  const models = listSelectableOpencodeModels(workspaceRootPath);
  if (models.length === 0) {
    return null;
  }
  const trimmed = preferredModelId?.trim();
  if (trimmed && models.some((model) => model.id === trimmed)) {
    return trimmed;
  }
  return models[0]!.id;
}

export function isOpencodeCatalogReady(workspaceRootPath: string): boolean {
  const catalog = getOpencodeCatalog(workspaceRootPath);
  return catalog.status === "loaded";
}

export function isOpencodeCatalogEmpty(workspaceRootPath: string): boolean {
  const catalog = getOpencodeCatalog(workspaceRootPath);
  return catalog.status === "loaded" && catalog.models.length === 0;
}
