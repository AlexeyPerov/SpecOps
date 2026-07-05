/**
 * Environment variables for remote git operations that must not block on a TTY.
 *
 * `GIT_TERMINAL_PROMPT=0` prevents git from prompting on the terminal for HTTPS
 * credentials. When no credential helper or in-app askpass is available, git
 * fails immediately instead of hanging until cancel.
 *
 * `GIT_SSH_COMMAND` uses SSH BatchMode so missing keys/agents fail fast. When
 * {@link buildAskpassEnv} is merged in, `SSH_ASKPASS` handles SSH passphrase
 * prompts and BatchMode is omitted so the askpass helper can run.
 */
export function buildNonInteractiveRemoteEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes",
  };
}

/** Merge base remote env with per-command overrides (askpass paths, etc.). */
export function mergeRemoteGitEnv(
  base: Record<string, string>,
  overrides?: Record<string, string>,
): Record<string, string> {
  if (!overrides || Object.keys(overrides).length === 0) {
    return { ...base };
  }
  return { ...base, ...overrides };
}
