import { createWorkspaceAgentBackend, type OpencodeCommandEntry } from "./workspaceAgentBackend";
import { logDiagnostic } from "../../services/logging";
import { appState } from "../../state/appState";
import type { OpencodeTransportMode } from "../../domain/contracts";
import { isOpencodeEnabled } from "../../services/opencodeSettings";

/**
 * Slash command catalog for the composer popover (M3-T1).
 *
 * Commands are workspace-scoped (OpenCode's `command.list` honours the
 * `?directory=` query that the SDK sets from `createOpencodeClient({
 * directory })`). They can be project-specific, so the cache is per-workspace
 * and refreshed on workspace open.
 *
 * Behaviour (per [questions.md Q11](../../specs/ops/phase-3.5/questions.md)):
 * selecting a command inserts its `template` into the composer for editing —
 * nothing is executed server-side from here.
 */

export type OpencodeCommandCatalogStatus = "idle" | "loading" | "loaded" | "error";

export interface OpencodeCommandCatalogState {
  status: OpencodeCommandCatalogStatus;
  commands: OpencodeCommandEntry[];
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyCatalog: OpencodeCommandCatalogState = {
  status: "idle",
  commands: [],
  lastErrorMessage: null,
  loadedAt: null,
};

const catalogCache = new Map<string, OpencodeCommandCatalogState>();
const inflightRequests = new Map<string, Promise<OpencodeCommandCatalogState>>();

export function getOpencodeCommands(workspaceRootPath: string): OpencodeCommandCatalogState {
  return catalogCache.get(workspaceRootPath) ?? emptyCatalog;
}

export function resetOpencodeCommandsForTests(): void {
  catalogCache.clear();
  inflightRequests.clear();
}

function updateCache(workspaceRootPath: string, state: OpencodeCommandCatalogState): void {
  catalogCache.set(workspaceRootPath, state);
}

function emitDiagnostic(input: {
  reason: string;
  workspaceRootPath: string;
  level?: "debug" | "warn";
  error?: unknown;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "opencode command catalog refresh",
    metadata: {
      kind: "opencode.commands.refresh",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

export async function refreshOpencodeCommands(
  workspaceRootPath: string,
): Promise<OpencodeCommandCatalogState> {
  const existing = inflightRequests.get(workspaceRootPath);
  if (existing) {
    return existing;
  }

  const snapshot = appState.getSnapshot();
  if (!isOpencodeEnabled(snapshot.settings.opencode)) {
    const state: OpencodeCommandCatalogState = {
      status: "idle",
      commands: [],
      lastErrorMessage: null,
      loadedAt: null,
    };
    updateCache(workspaceRootPath, state);
    return state;
  }

  updateCache(workspaceRootPath, {
    ...getOpencodeCommands(workspaceRootPath),
    status: "loading",
  });

  const promise = (async (): Promise<OpencodeCommandCatalogState> => {
    try {
      const backend = createWorkspaceAgentBackend("opencode", {
        resolveRuntimeConfig: async (): Promise<{
          mode: OpencodeTransportMode;
          baseUrl: string;
        }> => {
          const { mode, baseUrl } = appState.getSnapshot().settings.opencode;
          return { mode, baseUrl };
        },
      });
      const commands = await backend.listCommands({ workspaceRootPath });
      const deduped = dedupeCommands(commands);
      const state: OpencodeCommandCatalogState = {
        status: "loaded",
        commands: deduped,
        lastErrorMessage: null,
        loadedAt: new Date().toISOString(),
      };
      updateCache(workspaceRootPath, state);
      emitDiagnostic({ reason: "loaded", workspaceRootPath });
      return state;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load OpenCode commands.";
      const state: OpencodeCommandCatalogState = {
        status: "error",
        commands: [],
        lastErrorMessage: message,
        loadedAt: null,
      };
      updateCache(workspaceRootPath, state);
      emitDiagnostic({ reason: "error", workspaceRootPath, level: "warn", error });
      return state;
    } finally {
      inflightRequests.delete(workspaceRootPath);
    }
  })();

  inflightRequests.set(workspaceRootPath, promise);
  return promise;
}

/**
 * Case-insensitive substring filter over command name + description. The query
 * is the text the user typed after `/` (without the leading slash); an empty
 * query returns every command.
 */
export function filterCommands(
  commands: readonly OpencodeCommandEntry[],
  query: string,
): OpencodeCommandEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [...commands];
  }
  return commands.filter((command) => {
    return (
      command.name.toLowerCase().includes(trimmed) ||
      (command.description ? command.description.toLowerCase().includes(trimmed) : false)
    );
  });
}

/**
 * Returns `true` when the cursor should trigger the slash command popover.
 * Triggers when the textarea value up to the caret is either the empty string
 * or ends in whitespace followed by a single `/` and nothing else. So `/init`
 * at the start, or `hello /init` after a space, both open the popover.
 */
export function shouldTriggerSlashPopover(value: string, caret: number): {
  trigger: boolean;
  /** The slice after the trigger `/`, used as the filter query. */
  query: string;
} {
  if (caret < 0 || caret > value.length) {
    return { trigger: false, query: "" };
  }
  const upToCaret = value.slice(0, caret);
  // Find the last unbroken `/`-prefixed token: a `/` preceded by start-of-text
  // or whitespace, followed by non-whitespace chars only.
  const match = /(?:^|\s)\/(\S*)$/.exec(upToCaret);
  if (!match) {
    return { trigger: false, query: "" };
  }
  return { trigger: true, query: match[1] ?? "" };
}

/**
 * Returns the text replacement for inserting a command's template. The bare
 * template text replaces the trailing `/<query>` token the user typed. When
 * no trigger token is present (e.g. insertion from a menu click with an empty
 * composer), the template is appended after a separating space.
 */
export function buildSlashReplacement(input: {
  value: string;
  caret: number;
  template: string;
}): { value: string; caret: number } {
  const { value, caret, template } = input;
  const upToCaret = value.slice(0, caret);
  const rest = value.slice(caret);
  const slashIndex = upToCaret.lastIndexOf("/");
  if (slashIndex < 0) {
    const sep = value.length > 0 && !value.endsWith(" ") ? " " : "";
    const next = `${value}${sep}${template}`;
    return { value: next, caret: next.length };
  }
  // Only replace when the slash is at the start or follows whitespace (a
  // genuine trigger token, not a slash inside a URL like `https://`).
  const charBefore = slashIndex === 0 ? "" : value[slashIndex - 1];
  if (charBefore && !/\s/.test(charBefore)) {
    const sep = value.length > 0 && !value.endsWith(" ") ? " " : "";
    const next = `${value}${sep}${template}`;
    return { value: next, caret: next.length };
  }
  const before = value.slice(0, slashIndex);
  const next = `${before}${template}${rest}`;
  const nextCaret = (before + template).length;
  return { value: next, caret: nextCaret };
}

/** De-duplicates commands by name, last definition wins (mirrors `dedupe`
 * behaviour elsewhere in the app). */
function dedupeCommands(commands: readonly OpencodeCommandEntry[]): OpencodeCommandEntry[] {
  const seen = new Map<string, OpencodeCommandEntry>();
  for (const command of commands) {
    seen.set(command.name, command);
  }
  return [...seen.values()];
}
