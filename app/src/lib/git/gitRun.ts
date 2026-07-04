import { invoke } from "@tauri-apps/api/core";
import { logDiagnostic } from "../services/logging";
import { enqueueGitCommandForRepo } from "./gitCommandQueue";
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

const GIT_AVAILABILITY_TTL_MS = 60_000;

let cachedGitAvailability: GitAvailableResponse | null = null;
let gitAvailabilityExpiresAt = 0;
let gitAvailabilityProbe: Promise<GitAvailableResponse> | null = null;

export function logGitCommandSummary(
  repoRoot: string,
  args: string[],
  response: RunGitResponse,
): void {
  const command = `git ${args.join(" ")}`;
  const stderr = response.stderr.trim();
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
      ...(response.exitCode !== 0 && stderr ? { stderr } : {}),
    },
  });
}

async function invokeRunGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  try {
    const response = await invoke<RunGitResponse>("run_git", {
      repoRoot,
      args,
      ...(env ? { env } : {}),
      ...(options?.commandId ? { commandId: options.commandId } : {}),
      ...(options?.askpass ? { askpassEnabled: true } : {}),
      ...(options?.askpassOperation ? { askpassOperation: options.askpassOperation } : {}),
      ...(options?.askpassTimeoutMs ? { askpassTimeoutMs: options.askpassTimeoutMs } : {}),
      ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
    logGitCommandSummary(repoRoot, args, response);
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
