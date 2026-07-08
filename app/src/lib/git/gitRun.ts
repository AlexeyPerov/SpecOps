import { invoke } from "@tauri-apps/api/core";
import { logDiagnostic } from "../services/logging";
import { enqueueGitCommandForRepo } from "./gitCommandQueue";
import { sanitizeGitStderrForDiagnosticLog } from "./gitDiagnosticSanitize";
import { buildNonInteractiveRemoteEnv } from "./gitRemoteEnv";
import { isGitIntegrationEnabledInApp } from "./gitIntegrationGating";
import {
  mapGitInvokeError,
  type CancelGitCommandResponse,
  type CancellableGitOptions,
  type GitAskpassOperation,
  type GitAvailableResponse,
  type RemoveStaleIndexLockResponse,
  type RunGitResponse,
} from "./types";

/** Default ceiling for remote git network operations (10 minutes). */
export const REMOTE_GIT_OPERATION_TIMEOUT_MS = 10 * 60 * 1000;

/** Default ceiling for local git subprocess operations (5 minutes). */
export const LOCAL_GIT_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

const GIT_INTEGRATION_DISABLED_MESSAGE = "Git integration is disabled in Settings.";

const GIT_INTEGRATION_DISABLED_RESPONSE: RunGitResponse = {
  exitCode: 1,
  stdout: "",
  stderr: GIT_INTEGRATION_DISABLED_MESSAGE,
  durationMs: 0,
};

const GIT_INTEGRATION_DISABLED_AVAILABILITY: GitAvailableResponse = {
  available: false,
  version: null,
  error: GIT_INTEGRATION_DISABLED_MESSAGE,
};

const GIT_AVAILABILITY_TTL_MS = 60_000;
const INDEX_LOCK_MAX_RETRIES = 3;
const INDEX_LOCK_RETRY_BASE_DELAY_MS = 200;

/**
 * Local git subcommands that mutate the repository and may hold `.git/index.lock`.
 *
 * These are registered with the Rust backend (assigned a `commandId` + local timeout)
 * so they can be drained on app exit — quitting SpecOps mid-`add`/`commit`/`stash`/
 * `checkout` reaps the child and cleans up its index lock instead of orphaning it.
 *
 * Read-only commands (`status`, `diff`, `log`, `show`, `rev-parse`, `rev-list`,
 * `ls-remote`, `remote`, `branch` listing, `tag` listing, `stash list`) stay on the
 * fast non-registered Rust path; they never hold the index lock and registering them
 * caused the "stuck on loading" probe bug (commit be12c58).
 */
const WRITE_GIT_SUBCOMMANDS = new Set<string>([
  "add",
  "commit",
  "restore",
  "checkout",
  "stash",
  "fetch",
  "pull",
  "push",
  "tag",
  "branch",
  "init",
  "config",
]);

function isWriteGitCommand(args: string[]): boolean {
  const subcommand = args[0];
  if (!subcommand || !WRITE_GIT_SUBCOMMANDS.has(subcommand)) {
    return false;
  }
  // `branch` and `tag` with no destructive flag are reads; only register when they
  // actually mutate. Listing forms (`-l`, `--list`, `-v`, `-vv`, no args) stay fast.
  if (subcommand === "branch" || subcommand === "tag") {
    const rest = args.slice(1);
    const isListing = rest.length === 0
      || rest.some((arg) => arg === "-l" || arg === "--list" || arg === "-v" || arg === "-vv");
    return !isListing;
  }
  // `config` without a value is a read (`config --get <key>`); with a value it's a write.
  if (subcommand === "config") {
    const rest = args.slice(1);
    const isGet = rest.some((arg) => arg === "--get" || arg === "--get-all");
    if (isGet) {
      return false;
    }
    // `config <key> <value>` (two non-flag operands) is a write.
    const operands = rest.filter((arg) => !arg.startsWith("-"));
    return operands.length >= 2;
  }
  // `stash list` is a read; other stash subcommands mutate.
  if (subcommand === "stash") {
    const action = args[1];
    return action !== "list";
  }
  return true;
}

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

/**
 * Ask the backend to remove a stale `.git/index.lock` for `repo_root`.
 *
 * The backend refuses when an in-flight SpecOps git command for this repo is
 * registered (the lock may be legitimately held), so this is safe to call
 * speculatively — it only ever removes a lock that no tracked process owns.
 */
async function removeStaleIndexLock(repoRoot: string): Promise<void> {
  try {
    await invoke<RemoveStaleIndexLockResponse>("remove_stale_index_lock", {
      request: { repoRoot },
    });
  } catch {
    // Best-effort: if the IPC fails, the retry loop below still runs.
  }
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
      // On the first index-lock failure, ask the backend to remove a stale lock
      // left by a crash, force-quit, or an external writer (e.g. the OpenCode
      // sidecar). The backend only removes it when no SpecOps git command is
      // active for this repo, so a genuinely held lock is left untouched.
      if (attempt === 0) {
        await removeStaleIndexLock(repoRoot);
      }
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
 *
 * Write operations (see {@link isWriteGitCommand}) are auto-registered with the Rust
 * backend so they can be drained on app exit — a mid-flight `add`/`commit`/`stash`/
 * `checkout` is reaped and its `.git/index.lock` cleaned up instead of orphaned.
 * Callers may still pass an explicit `commandId` to make a command user-cancellable.
 * Read-only commands stay on the fast non-registered Rust path.
 */
export async function runGit(
  repoRoot: string,
  args: string[],
  env?: Record<string, string>,
  options?: CancellableGitOptions,
): Promise<RunGitResponse> {
  if (!isGitIntegrationEnabledInApp()) {
    return GIT_INTEGRATION_DISABLED_RESPONSE;
  }
  // Register write operations so they are drainable on app exit. Callers that
  // already pass a commandId (user-cancellable remote ops) keep their options.
  // Read-only commands stay unregistered (fast Rust path).
  const effectiveOptions: CancellableGitOptions | undefined =
    options?.commandId || isWriteGitCommand(args)
      ? {
          ...(options ?? {}),
          commandId: options?.commandId ?? crypto.randomUUID(),
          timeoutMs: options?.timeoutMs ?? LOCAL_GIT_OPERATION_TIMEOUT_MS,
        }
      : options;
  return enqueueGitCommandForRepo(repoRoot, () =>
    invokeRunGit(repoRoot, args, env, effectiveOptions),
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
  if (!isGitIntegrationEnabledInApp()) {
    return GIT_INTEGRATION_DISABLED_AVAILABILITY;
  }

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

/** Terminate all in-flight registered git subprocesses (best-effort). */
export async function drainGitCommands(): Promise<void> {
  try {
    await invoke("drain_git_commands");
  } catch {
    // Best-effort when integration is being disabled.
  }
  resetGitAvailabilityCacheForTests();
}
