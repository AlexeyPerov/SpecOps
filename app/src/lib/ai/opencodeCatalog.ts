import { createWorkspaceAgentBackend, type OpencodeModelEntry, type OpencodeProviderEntry, type OpencodeAgentEntry } from "./backends/workspaceAgentBackend";
import { logDiagnostic } from "../services/logging";
import { appState } from "../state/appState";
import type { OpencodeTransportMode } from "../domain/contracts";

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

const catalogCache = new Map<string, OpencodeCatalogState>();

const inflightRequests = new Map<string, Promise<OpencodeCatalogState>>();

export function getOpencodeCatalog(workspaceRootPath: string): OpencodeCatalogState {
  return catalogCache.get(workspaceRootPath) ?? emptyCatalog;
}

export function resetOpencodeCatalogForTests(): void {
  catalogCache.clear();
  inflightRequests.clear();
}

function resolveRuntimeConfig() {
  const { mode, baseUrl } = appState.getSnapshot().settings.opencode;
  return { mode, baseUrl };
}

function updateCache(workspaceRootPath: string, state: OpencodeCatalogState): void {
  catalogCache.set(workspaceRootPath, state);
}

function emitCatalogDiagnostic(input: {
  reason: string;
  workspaceRootPath: string;
  level?: "debug" | "warn";
  error?: unknown;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "opencode catalog refresh",
    metadata: {
      kind: "opencode.catalog.refresh",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

export async function refreshOpencodeCatalog(workspaceRootPath: string): Promise<OpencodeCatalogState> {
  const existing = inflightRequests.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  updateCache(workspaceRootPath, {
    ...getOpencodeCatalog(workspaceRootPath),
    status: "loading",
  });

  const promise = (async (): Promise<OpencodeCatalogState> => {
    try {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async (): Promise<{ mode: OpencodeTransportMode; baseUrl: string }> => resolveRuntimeConfig(),
      });

      const [models, providers, agents] = await Promise.all([
        backend.listModels({ workspaceRootPath }),
        backend.listProviders({ workspaceRootPath }),
        backend.listAgents({ workspaceRootPath }),
      ]);

      const state: OpencodeCatalogState = {
        status: "loaded",
        models,
        providers,
        agents,
        lastErrorMessage: null,
        loadedAt: new Date().toISOString(),
      };

      updateCache(workspaceRootPath, state);
      emitCatalogDiagnostic({ reason: "loaded", workspaceRootPath });
      return state;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load OpenCode catalog.";
      const state: OpencodeCatalogState = {
        status: "error",
        models: [],
        providers: [],
        agents: [],
        lastErrorMessage: message,
        loadedAt: null,
      };
      updateCache(workspaceRootPath, state);
      emitCatalogDiagnostic({ reason: "error", workspaceRootPath, level: "warn", error });
      return state;
    } finally {
      inflightRequests.delete(workspaceRootPath);
    }
  })();

  inflightRequests.set(workspaceRootPath, promise);
  return promise;
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
