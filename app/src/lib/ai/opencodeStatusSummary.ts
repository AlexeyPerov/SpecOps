import type { Readable } from "svelte/store";
import { type OpencodeLspStatusEntry } from "./backends/workspaceAgentBackend";
import { createReactiveResourceStore } from "./opencodeResourceStore";

/**
 * M5-T4 — workspace status summary. Aggregates the LSP / MCP / provider /
 * model / permission surfaces the status popover shows. Each source is
 * fetched in parallel and degraded independently so one flaky endpoint
 * never blanks the popover: LSP / MCP failures become empty arrays, the
 * permission rule count falls back to 0, model info to null.
 *
 * The store is keyed by workspace root (one summary per open workspace).
 * M10-T1: the cache + inflight + diagnostic skeleton now lives in
 * `createReactiveResourceStore`.
 */

export type StatusSummaryStoreStatus = "idle" | "loading" | "loaded" | "error";

export interface StatusSummaryState {
  status: StatusSummaryStoreStatus;
  lspServers: OpencodeLspStatusEntry[];
  /** MCP server count (connected / total). */
  mcpConnected: number;
  mcpTotal: number;
  /** Providers connected / total (from `provider.list`). */
  providersConnected: number;
  providersTotal: number;
  /** Number of permission rules in the OpenCode config. */
  permissionRuleCount: number;
  /** Default model id from config, if set. */
  defaultModelId: string | null;
  defaultAgentId: string | null;
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyState: StatusSummaryState = {
  status: "idle",
  lspServers: [],
  mcpConnected: 0,
  mcpTotal: 0,
  providersConnected: 0,
  providersTotal: 0,
  permissionRuleCount: 0,
  defaultModelId: null,
  defaultAgentId: null,
  lastErrorMessage: null,
  loadedAt: null,
};

const store = createReactiveResourceStore<StatusSummaryState, string>({
  diagnosticLabel: "status summary",
  diagnosticKind: "opencode.status.summary.refresh",
  reactive: true,
  keyOf: (workspaceRootPath) => workspaceRootPath,
  diagnosticExtra: (workspaceRootPath) => ({ workspaceRootPath }),
  copyEmptyState: () => ({ ...emptyState }),
  disabledState: () => ({ ...emptyState }),
  buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
  buildErrorState: (message) => ({
    ...emptyState,
    status: "error",
    lastErrorMessage: message,
  }),
  async fetch(backend, workspaceRootPath) {
    // Each source is fetched independently and degraded to a safe default
    // on failure so the popover always has *something* to show.
    const [lspServers, mcpStatuses, providerStatuses, config] = await Promise.all([
      backend.listLspStatuses({ workspaceRootPath }).catch(() => [] as OpencodeLspStatusEntry[]),
      backend.listMcpStatuses({ workspaceRootPath }).catch(() => []),
      backend.listProviderStatuses({ workspaceRootPath }).catch(() => []),
      backend.getConfig({ workspaceRootPath }).catch(() => ({} as Record<string, unknown>)),
    ]);

    const mcpTotal = mcpStatuses.length;
    const mcpConnected = mcpStatuses.filter((entry) => entry.status === "connected").length;
    const providersTotal = providerStatuses.length;
    const providersConnected = providerStatuses.filter((entry) => entry.connected).length;
    const { permissionRuleCount, defaultModelId, defaultAgentId } = readConfigSummary(config);

    return {
      status: "loaded",
      lspServers,
      mcpConnected,
      mcpTotal,
      providersConnected,
      providersTotal,
      permissionRuleCount,
      defaultModelId,
      defaultAgentId,
      lastErrorMessage: null,
      loadedAt: new Date().toISOString(),
    };
  },
});

export function getStatusSummary(workspaceRootPath: string): Readable<StatusSummaryState> {
  return store.getReadable(workspaceRootPath);
}

export function getStatusSummarySnapshot(workspaceRootPath: string): StatusSummaryState {
  return store.getSnapshot(workspaceRootPath);
}

export function resetStatusSummaryForTests(): void {
  store.resetForTests();
}

export async function refreshStatusSummary(input: {
  workspaceRootPath: string;
}): Promise<StatusSummaryState> {
  return store.refresh(input.workspaceRootPath);
}

export function clearStatusSummary(workspaceRootPath: string): void {
  store.clear(workspaceRootPath);
}

// -- Pure helpers (exposed for tests) -----------------------------------------

/**
 * Extracts the popover-relevant fields from a loose config document:
 * permission rule count (rows under the `permission:` key), the default
 * model id, and the default agent id. Tolerant of missing / malformed keys.
 */
export function readConfigSummary(config: Record<string, unknown>): {
  permissionRuleCount: number;
  defaultModelId: string | null;
  defaultAgentId: string | null;
} {
  const permissionRuleCount = countPermissionRules(config.permission);
  const defaultModelId = readStringField(config, "model");
  const defaultAgentId = readStringField(config, "default_agent");
  return { permissionRuleCount, defaultModelId, defaultAgentId };
}

/**
 * Counts permission rules. The `permission:` config value is polymorphic:
 * a bare action string ("allow"/"deny"/"ask") = 0 explicit rules; a per-tool
 * map `{ tool: { pattern: action } }` counts every pattern entry; a flat
 * array of `{ permission, pattern, action }` rows counts every entry.
 */
export function countPermissionRules(permission: unknown): number {
  if (typeof permission === "string") {
    return 0;
  }
  if (Array.isArray(permission)) {
    return permission.length;
  }
  if (permission && typeof permission === "object") {
    let count = 0;
    for (const value of Object.values(permission as Record<string, unknown>)) {
      if (typeof value === "string") {
        // Bare action per tool — counts as one default rule.
        count += 1;
      } else if (value && typeof value === "object") {
        count += Object.keys(value as Record<string, unknown>).length;
      }
    }
    return count;
  }
  return 0;
}

function readStringField(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}
