import { invoke } from "@tauri-apps/api/core";
import { logDiagnostic } from "../services/logging";
import { enqueueGitCommandForRepo } from "./gitCommandQueue";
import { sanitizeGitStderrForDiagnosticLog } from "./gitDiagnosticSanitize";
import { buildNonInteractiveRemoteEnv } from "./gitRemoteEnv";
import {
  mapGitInvokeError,
  type CancelGitCommandResponse,
  type CancellableGitOptions,
  type GitAskpassOperation,
  type GitAvailableResponse,
  type RunGitResponse,
} from "./types";

/** Default ceiling for remote git network operations (10 minutes). */
export const REMOTE_GIT_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;

/** Default ceiling for local git subprocess operations (5 minutes). */
export const LOCAL_GIT_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

const GIT_AVAILABILITY_TTL_MS = 60_000;
const INDEX_LOCK_MAX_RETRIES = 3;
const INDEX_LOCK_RETRY_BASE_DELAY_MS = 200;

let cachedGitAvailability: GitAvailableResponse | null = null;
let gitAvailabilityExpiresAt = 0;
let gitAvailabilityProbe: Promise<GitAvailableResponse> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isIndexLockResponse(response: RunGitResponse): boolean {
  const stderr = response.stderr.toLowerCase();
  return (
    stderr.includes("index.lock") ||
    (stderr.includes("unable to create") && stderr.includes("lock"))
  );
}

function resolveGitCommandTimeout(options?: CancellableGitOptions): number {
  if (options?.timeoutMs !== undefined) {
    return options.timeoutMs;
  }
  if (options?.askpass) {
    return REMOTE_GIT_OPERATION_TIMEOUT_MS;
  }
  return LOCAL_GIT_OPERATION_TIMEOUT_MS;
}

/** Tauri IPC payload for `run_git` (Rust handler takes a single `request` arg). */
export function runGitInvokeArgs(
  repoRoot: string,
  args: string[],
  extra: Record<string, unknown> = {},
): { request: Record<string, unknown> } {
  return {
    request: {
      repoRoot,
      args,
      ...extra,
    },
  };
}

/** Tauri IPC payload for `git_commit_with_message`. */
export function gitCommitInvokeArgs(
  repoRoot: string,
  message: string,
  extra: Record<string, unknown> = {},
): { request: Record<string, unknown> } {
  return {
    request: {
      repoRoot,
      message,
      ...extra,
    },
  };
}

export function logGitCommandSummary(
  repoRoot: string,
  args: string[],
  response: RunGitResponse,
): void {
  const command = `git ${args.join(" ")}`;
  const stderr = response.stderr.trim();
  const sanitizedStderr = stderr ? sanitizeGitStderrForDiagnosticLog(stderr) : "";
  void logDiagnostic({
    level: response.exitCode === 0 ? "info" : "warn",
    source: "frontend",
    message: `${command} → exit ${response.exitCode}`,
    timestamp: new Date().toISOString(),
    metadata: {
      command: args,
      exitCode: response.exitCode,
      durationMs: response.durationMs,
      repoRoot,
      ...(response.exitCode !== 0 && sanitizedStderr ? { stderr: sanitizedStderr } : {}),
    },
  });
}

function buildRunGitInvokePayload(
  repoRoot: string,
  args: string[],
  env: Record<string, string> | undefined,
  options?: CancellableGitOptions,
): { request: Record<string, unknown> } {
  const extra: Record<string, unknown> = {};
  if (env) {
    extra.env = env;
  }
  if (options?.commandId) {
    extra.commandId = options.commandId;
  }
  if (options?.askpass) {
    extra.askpassEnabled = true;
    if (options.askpassOperation) {
      extra.askpassOperation = options.askpassOperation;
    }
    if (options.askpassTimeoutMs !== undefined) {
      extra.askpassTimeoutMs = options.askpassTimeoutMs;
    }
  }
  if (options?.commandId || options?.askpass || options?.timeoutMs !== undefined) {
    extra.timeoutMs = resolveGitCommandTimeout(options);
  }
  return runGitInvokeArgs(repoRoot, args, extra);
}

async function invokeRunGitOnce(
  repoRoot: string,
  args: string[],
  env: Record<string, string> | undefined,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  const response = await invoke<RunGitResponse>(
    "run_git",
    buildRunGitInvokePayload(repoRoot, args, env, options),
  );
  logGitCommandSummary(repoRoot, args, response);
  return response;
}

async function invokeRunGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  try {
    let response = await invokeRunGitOnce(repoRoot, args, env, options);

    for (let attempt = 0; attempt < INDEX_LOCK_MAX_RETRIES && isIndexLockResponse(response); attempt += 1) {
      await sleep(INDEX_LOCK_RETRY_BASE_DELAY_MS * (attempt + 1));
      response = await invokeRunGitOnce(repoRoot, args, env, options);
    }

    return response;
  } catch (error) {
    throw mapGitInvokeError(error, repoRoot);
  }
}

/**
 * Run `git` in `repoRoot` with argv passed directly (no shell interpolation).
 *
 * Commands for the same repository root are serialized via {@link enqueueGitCommandForRepo};
 * unrelated repositories may run concurrently.
 */
export async function runGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  return enqueueGitCommandForRepo(repoRoot, () =>
    invokeRunGit(repoRoot, args, env, options),
  );
}

interface RemoteGitInvokeOptions extends CancellableGitOptions {
  operation: GitAskpassOperation;
}

/** Run a remote git command with non-interactive env and askpass enabled. */
export async function runRemoteGit(
  repoRoot: string,
  args: string[],
  options?: RemoteGitInvokeOptions,
): Promise<RunGitResponse> {
  const env = buildNonInteractiveRemoteEnv();
  return runGit(repoRoot, args, env, {
    ...options,
    askpass: true,
    askpassOperation: options?.operation,
    timeoutMs: options?.timeoutMs ?? REMOTE_GIT_OPERATION_TIMEOUT_MS,
    commandId: options?.commandId ?? crypto.randomUUID(),
  });
}

/** Terminate an in-flight cancellable git command by id. */
export async function cancelGitCommand(commandId: string): Promise<CancelGitCommandResponse> {
  try {
    return await invoke<CancelGitCommandResponse>("cancel_git_command", { commandId });
  } catch (error) {
    throw mapGitInvokeError(error, "");
  }
}

/** Clear cached git availability probe results (tests only). */
export function resetGitAvailabilityCacheForTests(): void {
  cachedGitAvailability = null;
  gitAvailabilityExpiresAt = 0;
  gitAvailabilityProbe = null;
}

async function probeGitAvailable(): Promise<GitAvailableResponse> {
  try {
    const response = await invoke<GitAvailableResponse>("git_available");
    if (response.available) {
      cachedGitAvailability = response;
      gitAvailabilityExpiresAt = Date.now() + GIT_AVAILABILITY_TTL_MS;
    } else {
      resetGitAvailabilityCacheForTests();
    }
    return response;
  } catch (error) {
    resetGitAvailabilityCacheForTests();
    throw mapGitInvokeError(error, "");
  }
}

/** Probe whether system `git` is available on PATH (cached for 60s per session). */
export async function checkGitAvailable(): Promise<GitAvailableResponse> {
  const now = Date.now();
  if (cachedGitAvailability && now < gitAvailabilityExpiresAt) {
    return cachedGitAvailability;
  }

  if (gitAvailabilityProbe) {
    return gitAvailabilityProbe;
  }

  gitAvailabilityProbe = probeGitAvailable();
  try {
    return await gitAvailabilityProbe;
  } finally {
    gitAvailabilityProbe = null;
  }
}
