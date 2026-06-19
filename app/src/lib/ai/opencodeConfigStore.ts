import type {
  OpencodeAgentDetail,
  OpencodeConfigDocument,
  OpencodeMcpConfig,
  OpencodeMcpStatusEntry,
  OpencodePermissionConfig,
  OpencodeProviderStatus,
  OpencodeSkillEntry,
} from "./backends/workspaceAgentBackend";
import { createOpencodeBackendFromAppState } from "./backends/opencodeBackendFactory";
import { createReactiveResourceStore } from "./opencodeResourceStore";
import { logDiagnostic } from "../services/logging";
import { appState } from "../state/appState";
import { isOpencodeEnabled } from "../services/opencodeSettings";

/**
 * Per-workspace reactive config-management service (M4). Loads the OpenCode
 * config document + provider / MCP / agent / skill lists, and persists edits
 * through `config.update` / the dedicated endpoints. Pull-only — the settings
 * panels read a snapshot on mount.
 *
 * M10-T1: the cache + inflight + diagnostic skeleton now lives in
 * `createReactiveResourceStore`. The `buildErrorState` override implements the
 * M7-T3 prior-data-preservation policy (a transient reload failure keeps the
 * cached slices; a genuine first-load failure still degrades to emptyState).
 * The mutation helpers (save / provider / MCP) write through the factory's
 * `setSnapshot` escape hatch since they update a slice outside the refresh
 * path.
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

const store = createReactiveResourceStore<OpencodeConfigStoreState, string>({
  diagnosticLabel: "opencode config store",
  diagnosticKind: "opencode.config.store",
  reactive: false,
  keyOf: (workspaceRootPath) => workspaceRootPath,
  diagnosticExtra: (workspaceRootPath) => ({ workspaceRootPath }),
  copyEmptyState: () => ({ ...emptyState }),
  disabledState: () => ({ ...emptyState }),
  buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
  buildErrorState: (message, prior) => {
    // M7-T3: a transient getConfig failure during a re-load must not wipe the
    // previously-good cached slices (savePermissionConfig depends on
    // current.config). Preserve the prior data and only flip status → "error"
    // + lastErrorMessage. A genuinely first-load failure (no prior data) still
    // degrades to emptyState.
    const hasPriorData =
      prior.status === "loaded" ||
      prior.config !== null ||
      prior.providers.length > 0 ||
      prior.mcpServers.length > 0 ||
      prior.agents.length > 0 ||
      prior.skills.length > 0;
    return hasPriorData
      ? { ...prior, status: "error", lastErrorMessage: message }
      : { ...emptyState, status: "error", lastErrorMessage: message };
  },
  async fetch(backend, workspaceRootPath) {
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

    return {
      status: "loaded",
      config,
      providers,
      mcpServers,
      agents,
      skills,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
  },
});

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

function createBackend() {
  // M10-T2: single source of truth for backend construction. Returns a backend
  // unconditionally — callers have already gated on `isConfigStoreAvailable`.
  return createOpencodeBackendFromAppState()!;
}

export function getOpencodeConfigStore(workspaceRootPath: string): OpencodeConfigStoreState {
  return store.getSnapshot(workspaceRootPath);
}

export function resetOpencodeConfigStoreForTests(): void {
  store.resetForTests();
}

/**
 * M10-T3 — per-workspace cache invalidation, wired to workspace-switch / close.
 */
export function clearOpencodeConfigStore(workspaceRootPath: string): void {
  store.clear(workspaceRootPath);
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
  return store.refresh(workspaceRootPath);
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
  store.setSnapshot(workspaceRootPath, { ...current, status: "saving" });
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
    store.setSnapshot(workspaceRootPath, state);
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
    store.setSnapshot(workspaceRootPath, state);
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
    store.setSnapshot(workspaceRootPath, {
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
    store.setSnapshot(workspaceRootPath, {
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
    store.setSnapshot(workspaceRootPath, {
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
