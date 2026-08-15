/**
 * Shared Agent Host client + lazy start (phase F, task AS01-F-03).
 *
 * The WebView never spawns or connects to the host process directly — the
 * Rust supervisor owns the process (commands `agent_host_*`). This module is
 * the single process-wide client instance plus an ensure-start helper cached
 * behind one promise (the send path and lifecycle actions call it before
 * their first host request), mirroring the old sidecar-ensure intent pattern.
 *
 * The bindings are injectable for tests: pipeline/component tests swap the
 * client via {@link bindAgentHostClientForTests} without a running Tauri app.
 */

import {
  createAgentHostClient,
  type AgentHostBindings,
  type AgentHostClient,
  type AgentHostStatus,
} from "../session/host/agentHostClient";
import type { AgentRuntimeId } from "../session/runtime";
import type {
  AgentModelDescriptor,
  AgentModeDescriptor,
} from "../session/binding";

/**
 * Runtime used for new sessions until runtime selection ships with real
 * adapters (phases 02+). The fake runtime is the only registered adapter.
 */
export const DEFAULT_SESSION_RUNTIME_ID: AgentRuntimeId = "fake";

let sharedClient: AgentHostClient | null = null;
let clientFactory: () => AgentHostClient = () => createAgentHostClient();
let ensureStartPromise: Promise<AgentHostStatus> | null = null;

/** The process-wide host client (lazily constructed, never null). */
export function getAgentHostClient(): AgentHostClient {
  sharedClient ??= clientFactory();
  return sharedClient;
}

/**
 * Ensure the supervised host is started. The start call runs at most once at
 * a time; concurrent callers await the same promise. A failed start clears
 * the cache so the next call retries.
 */
export async function ensureAgentHostStarted(): Promise<AgentHostStatus> {
  if (ensureStartPromise === null) {
    const client = getAgentHostClient();
    ensureStartPromise = client.start().catch((error: unknown) => {
      ensureStartPromise = null;
      throw error;
    });
  }
  return ensureStartPromise;
}

/** Reset the cached start promise (used after a host stop/restart). */
export function resetAgentHostEnsureCache(): void {
  ensureStartPromise = null;
}

/**
 * Swap the client factory + drop the shared instance. Test-only: lets unit
 * tests inject a fake client without a running Tauri backend. Pass `null` to
 * restore the default Tauri bindings.
 */
export function bindAgentHostClientForTests(
  factory: (() => AgentHostClient) | null,
): void {
  sharedClient = null;
  ensureStartPromise = null;
  clientFactory = factory ?? (() => createAgentHostClient());
}

export type { AgentHostBindings, AgentHostClient, AgentHostStatus };

/** Catalog snapshot for the runtime/model/mode pickers. */
export interface SessionCatalogSnapshot {
  status: "idle" | "loading" | "ready" | "error" | "empty";
  models: readonly AgentModelDescriptor[];
  modes: readonly AgentModeDescriptor[];
  /** Populated when `status === "error"`. */
  errorMessage?: string;
}

export const EMPTY_SESSION_CATALOG: SessionCatalogSnapshot = {
  status: "idle",
  models: [],
  modes: [],
};

/**
 * Load the model + mode catalogs for a runtime through the host. Degrades to
 * an explanatory snapshot instead of throwing so pickers can render disabled
 * states ("catalog unavailable", "no models") rather than blank UI.
 */
export async function loadSessionCatalogs(
  runtimeId: AgentRuntimeId,
): Promise<SessionCatalogSnapshot> {
  const client = getAgentHostClient();
  try {
    const [modelsResult, modesResult] = await Promise.all([
      client.catalogModels(runtimeId),
      client.catalogModes(runtimeId),
    ]);
    const models = [...modelsResult.models];
    const modes = [...modesResult.modes];
    if (models.length === 0 && modes.length === 0) {
      return { status: "empty", models, modes };
    }
    return { status: "ready", models, modes };
  } catch (error: unknown) {
    return {
      status: "error",
      models: [],
      modes: [],
      errorMessage:
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "Runtime catalog is unavailable.",
    };
  }
}
