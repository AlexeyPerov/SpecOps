import { createWorkspaceAgentBackend } from "./backends/workspaceAgentBackend";
import type {
  OpencodeAgentDetail,
  OpencodeConfigDocument,
  OpencodeMcpConfig,
  OpencodeMcpStatusEntry,
  OpencodePermissionConfig,
  OpencodeProviderStatus,
  OpencodeSkillEntry,
} from "./backends/workspaceAgentBackend";
import { logDiagnostic } from "../services/logging";
import { appState } from "../state/appState";
import type { OpencodeTransportMode } from "../domain/contracts";
import { isOpencodeEnabled } from "../services/opencodeSettings";

/**
 * Per-workspace reactive config-management service (M4). Loads the OpenCode
 * config document + provider / MCP / agent / skill lists, and persists edits
 * through `config.update` / the dedicated endpoints. Mirrors the cache +
 * inflight + diagnostic pattern of `opencodeCatalog.ts`.
 */

export type OpencodeConfigStoreStatus = "idle" | "loading" | "loaded" | "saving" | "error";

export interface OpencodeConfigStoreState {
  status: OpencodeConfigStoreStatus;
  config: OpencodeConfigDocument | null;
  providers: OpencodeProviderStatus[];
  mcpServers: OpencodeMcpStatusEntry[];
  agents: OpencodeAgentDetail[];
  skills: OpencodeSkillEntry[];
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyState: OpencodeConfigStoreState = {
  status: "idle",
  config: null,
  providers: [],
  mcpServers: [],
  agents: [],
  skills: [],
  lastErrorMessage: null,
  loadedAt: null,
};

const storeCache = new Map<string, OpencodeConfigStoreState>();
const inflightLoads = new Map<string, Promise<OpencodeConfigStoreState>>();

export function getOpencodeConfigStore(workspaceRootPath: string): OpencodeConfigStoreState {
  return storeCache.get(workspaceRootPath) ?? emptyState;
}

export function resetOpencodeConfigStoreForTests(): void {
  storeCache.clear();
  inflightLoads.clear();
}

function updateCache(workspaceRootPath: string, state: OpencodeConfigStoreState): void {
  storeCache.set(workspaceRootPath, state);
}

function resolveRuntimeConfig() {
  const { mode, baseUrl } = appState.getSnapshot().settings.opencode;
  return { mode, baseUrl };
}

function createBackend() {
  return createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async (): Promise<{ mode: OpencodeTransportMode; baseUrl: string }> =>
      resolveRuntimeConfig(),
  });
}

function emitDiagnostic(input: {
  reason: string;
  workspaceRootPath: string;
  level?: "debug" | "warn";
  error?: unknown;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "opencode config store",
    metadata: {
      kind: "opencode.config.store",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

/** True when OpenCode is enabled AND a workspace root is available. */
export function isConfigStoreAvailable(workspaceRootPath: string | null): boolean {
  if (!workspaceRootPath || workspaceRootPath.trim().length === 0) {
    return false;
  }
  return isOpencodeEnabled(appState.getSnapshot().settings.opencode);
}

/**
 * Loads the full config view (config doc + providers + MCP + agents + skills)
 * for a workspace. Subsequent calls within an in-flight request share the
 * promise. Degrades gracefully: provider/MCP/agent/skill failures don't abort
 * the load; only a config fetch failure surfaces as an error state.
 */
export async function loadOpencodeConfigStore(
  workspaceRootPath: string,
): Promise<OpencodeConfigStoreState> {
  const existing = inflightLoads.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  updateCache(workspaceRootPath, {
    ...getOpencodeConfigStore(workspaceRootPath),
    status: "loading",
  });

  const promise = (async (): Promise<OpencodeConfigStoreState> => {
    try {
      const backend = createBackend();
      const [config, providers, mcpServers, agents, skills] = await Promise.all([
        backend.getConfig({ workspaceRootPath }),
        backend
          .listProviderStatuses({ workspaceRootPath })
          .catch((error: unknown) => {
            emitDiagnostic({
              reason: "providers-failed",
              workspaceRootPath,
              level: "warn",
              error,
            });
            return [] as OpencodeProviderStatus[];
          }),
        backend
          .listMcpStatuses({ workspaceRootPath })
          .catch((error: unknown) => {
            emitDiagnostic({
              reason: "mcp-failed",
              workspaceRootPath,
              level: "warn",
              error,
            });
            return [] as OpencodeMcpStatusEntry[];
          }),
        backend
          .listAgentDetails({ workspaceRootPath })
          .catch((error: unknown) => {
            emitDiagnostic({
              reason: "agents-failed",
              workspaceRootPath,
              level: "warn",
              error,
            });
            return [] as OpencodeAgentDetail[];
          }),
        backend
          .listSkills({ workspaceRootPath })
          .catch((error: unknown) => {
            emitDiagnostic({
              reason: "skills-failed",
              workspaceRootPath,
              level: "warn",
              error,
            });
            return [] as OpencodeSkillEntry[];
          }),
      ]);

      const state: OpencodeConfigStoreState = {
        status: "loaded",
        config,
        providers,
        mcpServers,
        agents,
        skills,
        lastErrorMessage: null,
        loadedAt: new Date().toISOString(),
      };
      updateCache(workspaceRootPath, state);
      emitDiagnostic({ reason: "loaded", workspaceRootPath });
      return state;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load OpenCode config.";
      // M7-T3: a transient getConfig failure during a re-load must not wipe the
      // previously-good cached slices (savePermissionConfig depends on
      // current.config). Preserve the prior data and only flip status →
      // "error" + lastErrorMessage. A genuinely first-load failure (no prior
      // data) still degrades to emptyState.
      const prior = getOpencodeConfigStore(workspaceRootPath);
      const hasPriorData =
        prior.status === "loaded" ||
        prior.config !== null ||
        prior.providers.length > 0 ||
        prior.mcpServers.length > 0 ||
        prior.agents.length > 0 ||
        prior.skills.length > 0;
      const state: OpencodeConfigStoreState = hasPriorData
        ? { ...prior, status: "error", lastErrorMessage: message }
        : { ...emptyState, status: "error", lastErrorMessage: message };
      updateCache(workspaceRootPath, state);
      emitDiagnostic({ reason: "error", workspaceRootPath, level: "warn", error });
      return state;
    } finally {
      inflightLoads.delete(workspaceRootPath);
    }
  })();

  inflightLoads.set(workspaceRootPath, promise);
  return promise;
}

/**
 * Replaces the config document. The caller is expected to apply typed setters
 * (`setConfigModel`, etc. from `opencodeConfig.ts`) before calling this.
 * Returns the server-returned document (which may normalize keys).
 */
export async function saveOpencodeConfig(
  workspaceRootPath: string,
  config: OpencodeConfigDocument,
): Promise<OpencodeConfigStoreState> {
  const current = getOpencodeConfigStore(workspaceRootPath);
  updateCache(workspaceRootPath, { ...current, status: "saving" });
  try {
    const backend = createBackend();
    const updated = await backend.updateConfig({ workspaceRootPath, config });
    const state: OpencodeConfigStoreState = {
      ...current,
      status: "loaded",
      config: updated,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
    updateCache(workspaceRootPath, state);
    emitDiagnostic({ reason: "saved", workspaceRootPath });
    return state;
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to save OpenCode config.";
    const state: OpencodeConfigStoreState = {
      ...current,
      status: "error",
      lastErrorMessage: message,
    };
    updateCache(workspaceRootPath, state);
    emitDiagnostic({ reason: "save-error", workspaceRootPath, level: "warn", error });
    return state;
  }
}

// ---------------------------------------------------------------------------
// Provider management (M4-T2).
// ---------------------------------------------------------------------------

export async function setProviderApiKey(
  workspaceRootPath: string,
  providerId: string,
  apiKey: string,
): Promise<boolean> {
  try {
    const backend = createBackend();
    const ok = await backend.setProviderApiKey({ workspaceRootPath, providerId, apiKey });
    if (ok) {
      // Refresh provider statuses so the connected badge updates.
      void refreshProviders(workspaceRootPath);
    }
    return ok;
  } catch (error: unknown) {
    emitDiagnostic({ reason: "provider-key-failed", workspaceRootPath, level: "warn", error });
    return false;
  }
}

export async function removeProviderAuth(
  workspaceRootPath: string,
  providerId: string,
): Promise<boolean> {
  try {
    const backend = createBackend();
    const ok = await backend.removeProviderAuth({ workspaceRootPath, providerId });
    if (ok) {
      void refreshProviders(workspaceRootPath);
    }
    return ok;
  } catch (error: unknown) {
    emitDiagnostic({ reason: "provider-auth-remove-failed", workspaceRootPath, level: "warn", error });
    return false;
  }
}

export async function startProviderOAuth(
  workspaceRootPath: string,
  providerId: string,
): Promise<string | null> {
  try {
    const backend = createBackend();
    const url = await backend.startProviderOAuth({ workspaceRootPath, providerId });
    if (url) {
      void refreshProviders(workspaceRootPath);
    }
    return url;
  } catch (error: unknown) {
    emitDiagnostic({ reason: "provider-oauth-start-failed", workspaceRootPath, level: "warn", error });
    return null;
  }
}

export async function completeProviderOAuth(
  workspaceRootPath: string,
  providerId: string,
  code?: string,
): Promise<boolean> {
  try {
    const backend = createBackend();
    const ok = await backend.completeProviderOAuth({ workspaceRootPath, providerId, code });
    if (ok) {
      void refreshProviders(workspaceRootPath);
    }
    return ok;
  } catch (error: unknown) {
    emitDiagnostic({
      reason: "provider-oauth-complete-failed",
      workspaceRootPath,
      level: "warn",
      error,
    });
    return false;
  }
}

async function refreshProviders(workspaceRootPath: string): Promise<void> {
  try {
    const backend = createBackend();
    const providers = await backend.listProviderStatuses({ workspaceRootPath });
    updateCache(workspaceRootPath, {
      ...getOpencodeConfigStore(workspaceRootPath),
      providers,
    });
  } catch (error: unknown) {
    emitDiagnostic({ reason: "providers-refresh-failed", workspaceRootPath, level: "warn", error });
  }
}

// ---------------------------------------------------------------------------
// MCP server management (M4-T3).
// ---------------------------------------------------------------------------

export async function addMcpServer(
  workspaceRootPath: string,
  name: string,
  config: OpencodeMcpConfig,
): Promise<OpencodeMcpStatusEntry[]> {
  try {
    const backend = createBackend();
    const statuses = await backend.addMcpServer({ workspaceRootPath, name, config });
    updateCache(workspaceRootPath, {
      ...getOpencodeConfigStore(workspaceRootPath),
      mcpServers: statuses,
    });
    return statuses;
  } catch (error: unknown) {
    emitDiagnostic({ reason: "mcp-add-failed", workspaceRootPath, level: "warn", error });
    return [];
  }
}

export async function connectMcpServer(
  workspaceRootPath: string,
  name: string,
): Promise<boolean> {
  try {
    const backend = createBackend();
    const ok = await backend.connectMcpServer({ workspaceRootPath, name });
    if (ok) {
      await refreshMcpStatuses(workspaceRootPath);
    }
    return ok;
  } catch (error: unknown) {
    emitDiagnostic({ reason: "mcp-connect-failed", workspaceRootPath, level: "warn", error });
    return false;
  }
}

export async function disconnectMcpServer(
  workspaceRootPath: string,
  name: string,
): Promise<boolean> {
  try {
    const backend = createBackend();
    const ok = await backend.disconnectMcpServer({ workspaceRootPath, name });
    if (ok) {
      await refreshMcpStatuses(workspaceRootPath);
    }
    return ok;
  } catch (error: unknown) {
    emitDiagnostic({ reason: "mcp-disconnect-failed", workspaceRootPath, level: "warn", error });
    return false;
  }
}

async function refreshMcpStatuses(workspaceRootPath: string): Promise<void> {
  try {
    const backend = createBackend();
    const statuses = await backend.listMcpStatuses({ workspaceRootPath });
    updateCache(workspaceRootPath, {
      ...getOpencodeConfigStore(workspaceRootPath),
      mcpServers: statuses,
    });
  } catch (error: unknown) {
    emitDiagnostic({ reason: "mcp-refresh-failed", workspaceRootPath, level: "warn", error });
  }
}

// ---------------------------------------------------------------------------
// Permission persistence (M4-T5). Permission rules live in the config doc, so
// we apply them via the config save path.
// ---------------------------------------------------------------------------

export async function savePermissionConfig(
  workspaceRootPath: string,
  permission: OpencodePermissionConfig | undefined,
): Promise<boolean> {
  const current = getOpencodeConfigStore(workspaceRootPath);
  if (!current.config) {
    return false;
  }
  const next = { ...current.config };
  if (permission === undefined) {
    delete next.permission;
  } else {
    next.permission = permission;
  }
  const state = await saveOpencodeConfig(workspaceRootPath, next);
  return state.status !== "error";
}
