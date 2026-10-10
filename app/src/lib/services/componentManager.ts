/** Finite native component management, independent of Agent Host and provider SDKs. */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type ComponentId = "node" | "codex" | "opencode" | "claude" | "cursor";
export type ComponentState = "missing" | "installing" | "verifying" | "installed" | "update-available" | "in-use" | "failed" | "incompatible" | "unsupported" | "unavailable";
export type InstallError = "unavailable" | "unsupported" | "catalog" | "storage" | "low-disk" | "busy" | "stale" | "foreign" | "confirmation" | "limit" | "network" | "timeout" | "http" | "redirect" | "integrity" | "unsafe-archive" | "target" | "probe" | "cancelled" | "in-use" | "shutdown";
export interface ComponentRequest { id: ComponentId; version: string }
export interface ComponentPlan {
  planId: string; digest: string; catalogRevision: number; expiresAt: number;
  components: ComponentRequest[]; downloadBytes: number; requiredDiskBytes: number;
}
export interface ComponentConfirmation { planId: string; digest: string; confirmed: boolean }
export interface ComponentJob {
  operationId: string; generation: number; sequence: number;
  state: "downloading" | "verifying" | "activating" | "installed" | "failed" | "cancelled";
  id: ComponentId | null; completedBytes: number; totalBytes: number; error: InstallError | null;
}
export interface ComponentInventory { id: ComponentId; version: string; state: ComponentState; active: boolean; verified: boolean }
export interface ComponentDiagnostics {
  catalogRevision: number; target: { os: string; arch: string };
  components: ComponentInventory[]; jobs: ComponentJob[];
}
export const componentManager = {
  list: () => invoke<ComponentInventory[]>("component_list"),
  plan: (request: ComponentRequest) => invoke<ComponentPlan>("component_plan", { request }),
  install: (confirmation: ComponentConfirmation) => invoke<ComponentJob>("component_install", { confirmation }),
  cancel: (operationId: string, generation: number) => invoke<ComponentJob>("component_cancel", { operationId, generation }),
  retry: (operationId: string, generation: number, confirmation: ComponentConfirmation) => invoke<ComponentJob>("component_retry", { operationId, generation, confirmation }),
  update: (request: ComponentRequest) => invoke<ComponentPlan>("component_update", { request }),
  select: (request: ComponentRequest) => invoke<void>("component_select", { request }),
  remove: (request: ComponentRequest) => invoke<void>("component_remove", { request }),
  cleanCache: () => invoke<void>("component_clean_cache"),
  diagnostics: () => invoke<ComponentDiagnostics>("component_diagnostics"),
};

/** Drop foreign generations and late/out-of-order events before modifying a displayed job. */
const componentIds = new Set(["node", "codex", "opencode", "claude", "cursor"]);
const jobStates = new Set(["downloading", "verifying", "activating", "installed", "failed", "cancelled"]);
const errors = new Set(["unavailable", "unsupported", "catalog", "storage", "low-disk", "busy", "stale", "foreign", "confirmation", "limit", "network", "timeout", "http", "redirect", "integrity", "unsafe-archive", "target", "probe", "cancelled", "in-use", "shutdown"]);
export function newerComponentJob(current: ComponentJob | undefined, incoming: ComponentJob): boolean {
  if (!incoming || typeof incoming !== "object" || !jobStates.has(incoming.state) || (incoming.id !== null && !componentIds.has(incoming.id)) || (incoming.error !== null && !errors.has(incoming.error))) return false;
  const keys = new Set(["operationId", "generation", "sequence", "state", "id", "completedBytes", "totalBytes", "error"]);
  if (Object.keys(incoming).length !== keys.size || Object.keys(incoming).some(key => !keys.has(key))) return false;
  if (!Number.isSafeInteger(incoming.generation) || incoming.generation <= 0 || !Number.isSafeInteger(incoming.sequence) || incoming.sequence <= 0 || !Number.isSafeInteger(incoming.completedBytes) || !Number.isSafeInteger(incoming.totalBytes) || incoming.completedBytes < 0 || incoming.totalBytes < incoming.completedBytes || incoming.totalBytes > 1610612736) return false;
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(incoming.operationId)) return false;
  return !current || (current.operationId === incoming.operationId && current.generation === incoming.generation && incoming.sequence > current.sequence);
}
export function listenComponentJobs(onJob: (job: ComponentJob) => void): Promise<UnlistenFn> {
  return listen<ComponentJob>("component-status", event => { if (newerComponentJob(undefined, event.payload)) onJob(event.payload); });
}
