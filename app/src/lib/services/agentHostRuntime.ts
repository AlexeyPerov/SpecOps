import type { SessionConfigurationSchema } from "../session/adapter/extensions";
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
 * Production default for fresh sessions. Discovery also exposes the fake
 * runtime for account-free development; an isolated profile is required for Codex.
 */
export const DEFAULT_SESSION_RUNTIME_ID: AgentRuntimeId = "codex";

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
  const client = getAgentHostClient();
  if (ensureStartPromise !== null) {
    const previous = await ensureStartPromise;
    try {
      const current = await client.getStatus();
      if (current.running && current.generation === previous.generation) return current;
    } catch { /* A fresh start can recover a retired bridge. */ }
    ensureStartPromise = null;
  }
  ensureStartPromise ??= client.start().then(status => {
    if (!status.running) throw new Error("Agent Host did not start");
    return status;
  }).catch(error => { ensureStartPromise = null; throw error; });
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
  configuration?: SessionConfigurationSchema;
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
  connectionProfileId?: string,
): Promise<SessionCatalogSnapshot> {
  const client = getAgentHostClient();
  try {
    await ensureAgentHostStarted();
    const [modelsResult, modesResult] = await Promise.all([
      client.catalogModels(runtimeId, undefined, connectionProfileId),
      client.catalogModes(runtimeId, undefined, connectionProfileId),
    ]);
    const models = [...modelsResult.models];
    const modes = [...modesResult.modes];
    if (models.length === 0 && modes.length === 0) {
      return { status: "empty", models, modes };
    }
    return { status: "ready", models, modes, ...(modelsResult.configuration ? { configuration: modelsResult.configuration } : {}) };
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
