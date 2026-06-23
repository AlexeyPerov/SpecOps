import { logDiagnostic } from "./logging";
import {
  attachOpencodeSidecarWorkspace,
  getOpencodeSidecarStatus,
  isOpencodeSidecarError,
  type OpencodeSidecarError,
  type OpencodeSidecarStatus,
} from "./opencodeSidecar";

/**
 * M13.5 — central, intent-aware sidecar lifecycle service.
 *
 * Replaces the many places that called `attachOpencodeSidecarWorkspace`
 * unconditionally (workspace activation, catalog refresh on session-tab mount,
 * every backend call in sidecar mode). The new contract:
 *
 * - **Lazy** — sidecar is only spawned when an explicit caller asks for it
 *   (Send, Settings, Refresh model list, config sub-panels).
 * - **Single-flight** — concurrent callers share one in-flight attach promise.
 * - **Circuit breaker** — hard failures (port-in-use, missing binary, launch
 *   failure, health-timeout) block automatic attach paths until the user
 *   retries via Settings → Check connection or toggles OpenCode. In-memory
 *   only; cleared by an app restart, an explicit Settings intent, or any
 *   successful explicit start.
 *
 * Intents:
 *   - `"send"`              — primary spawn trigger; may attempt once even when
 *                             breaker is set; failure surfaces to the user.
 *   - `"settings"`          — Settings actions (Check connection, Refresh model
 *                             list, config sub-panels); clears the breaker.
 *   - `"background-sync"`   — reconcile + hydrate on session-tab switch; never
 *                             spawns; returns `null` when sidecar isn't running.
 *   - `"status-only"`       — probe-only, never spawns; returns current status
 *                             (or `null` when sidecar isn't running).
 */

export type EnsureOpencodeSidecarIntent =
  | "send"
  | "settings"
  | "background-sync"
  | "status-only";

export interface EnsureOpencodeSidecarInput {
  intent: EnsureOpencodeSidecarIntent;
  directory: string;
}

export interface EnsureOpencodeSidecarResult {
  status: OpencodeSidecarStatus;
  /** Whether a spawn was actually performed (true for the first concurrent caller). */
  spawned: boolean;
}

const HEALTH_POLL_INTERVAL_MS = 250;
const HEALTH_POLL_TIMEOUT_MS = 10_000;

let inflightAttach: Promise<OpencodeSidecarStatus> | null = null;
let inflightStatus: Promise<OpencodeSidecarStatus> | null = null;
let breakerActive = false;
let breakerError: OpencodeSidecarError | null = null;
let breakerLastFailureSignature: string | null = null;

const HARD_FAILURE_KINDS = new Set([
  "portInUse",
  "missingBinary",
  "launchFailure",
  "healthTimeout",
]);

function isHardFailure(error: OpencodeSidecarError | null): boolean {
  return error !== null && HARD_FAILURE_KINDS.has(error.kind);
}

function failureSignature(error: OpencodeSidecarError | null): string | null {
  if (!error) {
    return null;
  }
  return `${error.kind}:${error.message}`;
}

function setBreaker(error: OpencodeSidecarError): void {
  breakerActive = true;
  breakerError = error;
  breakerLastFailureSignature = failureSignature(error);
}

function clearBreaker(): void {
  breakerActive = false;
  breakerError = null;
  breakerLastFailureSignature = null;
}

export function isOpencodeSidecarBlocked(): boolean {
  return breakerActive;
}

export function getOpencodeSidecarBreakerError(): OpencodeSidecarError | null {
  return breakerActive ? breakerError : null;
}

export function clearOpencodeSidecarCircuitBreaker(): void {
  clearBreaker();
}

/**
 * Returns the signature of the most recent failure that tripped the breaker.
 * Used by the UI to dedupe snackbars — re-emitting the same failure (same
 * kind+message) should not flash a second snackbar.
 */
export function getOpencodeSidecarLastFailureSignature(): string | null {
  return breakerLastFailureSignature;
}

async function waitForHealthy(baseUrl: string): Promise<OpencodeSidecarStatus> {
  const started = Date.now();
  let lastStatus: OpencodeSidecarStatus | null = null;
  while (Date.now() - started < HEALTH_POLL_TIMEOUT_MS) {
    const status = await getOpencodeSidecarStatus();
    lastStatus = status;
    if (status.health === "healthy") {
      return status;
    }
    if (
      status.health === "error" ||
      (status.lastError && isHardFailure(status.lastError))
    ) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }
  if (lastStatus) {
    return lastStatus;
  }
  return {
    running: false,
    baseUrl: null,
    health: "error",
    directory: null,
    port: null,
    pid: null,
    lastError: {
      kind: "healthTimeout",
      port: 0,
      attempts: 0,
      message: "OpenCode sidecar did not become healthy in time.",
    },
  };
}

/**
 * Ensure the sidecar is running and healthy, gated by `intent`. See file
 * header for intent semantics.
 *
 * Returns:
 *   - `null` when the caller's intent doesn't allow spawn (status-only /
 *     background-sync and the sidecar isn't running yet) or when the circuit
 *     breaker is active and the caller's intent doesn't clear it.
 *   - an {@link EnsureOpencodeSidecarResult} when the sidecar is running (or
 *     was started by this call / a concurrent caller with an eligible intent).
 *
 * The `setOpencodeHealth` callback (optional) receives a health patch on
 * state transitions so the caller can publish to the app shell. Not required
 * — callers may also drive their own health updates.
 */
export async function ensureOpencodeSidecar(
  input: EnsureOpencodeSidecarInput,
  options: {
    setOpencodeHealth?: (patch: {
      status: OpencodeSidecarStatus["health"] | "checking" | "unknown";
      source: "sidecar";
      checkedAt: string;
      lastErrorMessage: string | null;
    }) => void;
  } = {},
): Promise<EnsureOpencodeSidecarResult | null> {
  const { intent, directory } = input;
  const nowIso = () => new Date().toISOString();

  // "status-only" and "background-sync" never spawn. When the breaker is
  // active, both return `null` immediately — background paths must not
  // touch the sidecar at all after a hard failure.
  if (intent === "status-only" || intent === "background-sync") {
    if (breakerActive) {
      return null;
    }
    const status = await (inflightStatus ??= (async () => {
      try {
        return await getOpencodeSidecarStatus();
      } finally {
        inflightStatus = null;
      }
    })());
    if (!status || !status.running || status.health === "error") {
      return null;
    }
    return { status, spawned: false };
  }

  // "send" and "settings" may spawn. "settings" clears the breaker.
  if (intent === "settings") {
    clearBreaker();
  }

  if (breakerActive && intent !== "settings") {
    // "send" may attempt once when breaker is set; surface the error to the
    // user. We let the call through but tag it via the published health.
    if (intent === "send") {
      const breakerStatus: OpencodeSidecarStatus = {
        running: false,
        baseUrl: null,
        health: "error",
        directory: null,
        port: null,
        pid: null,
        lastError: breakerError,
      };
      options.setOpencodeHealth?.({
        status: "error",
        source: "sidecar",
        checkedAt: nowIso(),
        lastErrorMessage: breakerError?.message ?? "OpenCode sidecar is unavailable.",
      });
      return { status: breakerStatus, spawned: false };
    }
    return null;
  }

  // Already-attached single-flight: join the in-flight promise if one is in
  // progress; otherwise kick off a new attach.
  const attachPromise =
    inflightAttach ??
    (inflightAttach = (async () => {
      try {
        options.setOpencodeHealth?.({
          status: "checking",
          source: "sidecar",
          checkedAt: nowIso(),
          lastErrorMessage: null,
        });
        const status = await attachOpencodeSidecarWorkspace(directory);
        // Wait for health to settle (non-blocking from the IPC perspective;
        // the Rust attach already returned). When health is "healthy" we
        // publish success and clear the breaker; when it ends in a hard
        // failure we trip the breaker and surface it.
        if (status.health === "checking") {
          const settled = await waitForHealthy(status.baseUrl ?? "");
          return settled;
        }
        return status;
      } finally {
        inflightAttach = null;
      }
    })());

  try {
    const status = await attachPromise;
    if (status.health === "healthy") {
      clearBreaker();
      options.setOpencodeHealth?.({
        status: "healthy",
        source: "sidecar",
        checkedAt: nowIso(),
        lastErrorMessage: null,
      });
      return { status, spawned: true };
    }
    if (status.lastError && isHardFailure(status.lastError)) {
      setBreaker(status.lastError);
      options.setOpencodeHealth?.({
        status: "error",
        source: "sidecar",
        checkedAt: nowIso(),
        lastErrorMessage: status.lastError.message,
      });
      return { status, spawned: true };
    }
    options.setOpencodeHealth?.({
      status: status.health,
      source: "sidecar",
      checkedAt: nowIso(),
      lastErrorMessage: status.lastError?.message ?? null,
    });
    return { status, spawned: true };
  } catch (error: unknown) {
    if (isOpencodeSidecarError(error) && isHardFailure(error)) {
      setBreaker(error);
      options.setOpencodeHealth?.({
        status: "error",
        source: "sidecar",
        checkedAt: nowIso(),
        lastErrorMessage: error.message,
      });
      const status: OpencodeSidecarStatus = {
        running: false,
        baseUrl: null,
        health: "error",
        directory: null,
        port: null,
        pid: null,
        lastError: error,
      };
      return { status, spawned: true };
    }
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : "Failed to start or attach OpenCode sidecar.";
    options.setOpencodeHealth?.({
      status: "error",
      source: "sidecar",
      checkedAt: nowIso(),
      lastErrorMessage: message,
    });
    throw error;
  }
}

/** Reset module state — used by tests. */
export function resetOpencodeSidecarEnsureForTests(): void {
  inflightAttach = null;
  inflightStatus = null;
  clearBreaker();
}

void logDiagnostic;