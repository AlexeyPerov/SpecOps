import { appState } from "../../state/appState";
import { isOpencodeEnabled } from "../../services/opencodeSettings";
import {
  createWorkspaceAgentBackend,
  type WorkspaceAgentBackend,
} from "./workspaceAgentBackend";

/**
 * M10-T2 — single place that knows how to build an OpenCode backend from the
 * live app-state settings. Replaces the ~10 copy-pasted `resolveRuntimeConfig` +
 * `createWorkspaceAgentBackend("opencode", { resolveRuntimeConfig })` closures
 * that previously lived inline in every store and `appShellAgentHandlers`.
 *
 * Reads `appState.getSnapshot().settings.opencode` **once** per call and returns
 * a freshly-constructed backend. Returns `null` when OpenCode is disabled (so
 * callers can short-circuit a refresh without constructing a backend they would
 * never use).
 *
 * M13.5 — `ensureIntent` controls whether the sidecar may spawn on a backend
 * API call:
 *   - `"send"`              — Send pipeline; spawn allowed.
 *   - `"settings"`          — Settings actions (default); spawn allowed.
 *   - `"background-sync"`   — auto reconcile / hydrate / catalog prefetch;
 *                              status-only (never spawns).
 *
 * Notes:
 * - This helper is intentionally side-effect-free beyond reading app state; it
 *   does not consult the workspace root (the backend resolves its own directory
 *   per-call from `workspaceRootPath`).
 * - Existing store / handler tests inject their own `createWorkspaceAgentBackend`
 *   via `vi.mock`, so this helper stays un-mocked — it just routes through the
 *   mocked factory. The injected mock returns a backend regardless of the
 *   enabled flag, which preserves the existing test behaviour.
 */
export function createOpencodeBackendFromAppState(input?: {
  ensureIntent?: "send" | "settings" | "background-sync" | "status-only";
}): WorkspaceAgentBackend | null {
  const { opencode } = appState.getSnapshot().settings;
  if (!isOpencodeEnabled(opencode)) {
    return null;
  }
  return createWorkspaceAgentBackend("opencode", {
    resolveRuntimeConfig: async () => ({
      mode: opencode.mode,
      baseUrl: opencode.baseUrl,
      sidecarPort: opencode.sidecarPort,
    }),
    ensureIntent: input?.ensureIntent ?? "settings",
  });
}
