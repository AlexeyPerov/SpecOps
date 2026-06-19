import {
  type OpencodeAgentEntry,
  type OpencodeFileSearchEntry,
} from "./workspaceAgentBackend";
import { createOpencodeBackendFromAppState } from "./opencodeBackendFactory";
import { logDiagnostic } from "../../services/logging";

/**
 * `@` mention search for the composer (M3-T2).
 *
 * Scope (per [questions.md Q12](../../specs/ops/phase-3.5/questions.md)):
 * files (via `fs.find`) + agents (from the already-loaded OpenCode catalog).
 * MCP resources and symbols are deferred.
 *
 * The picker shows both lists side-by-side; both are filtered client-side
 * against the user's query. File search is debounced because it hits the
 * OpenCode server each call.
 */

export interface MentionFileEntry {
  path: string;
  mime: string;
}

export interface MentionAgentEntry {
  id: string;
  name: string;
  /** True when the agent is a subagent (invokable via `@agent:` parts). */
  isSubagent?: boolean;
}

export interface MentionResults {
  files: MentionFileEntry[];
  agents: MentionAgentEntry[];
}

export type MentionSearchStatus = "idle" | "loading" | "loaded" | "error";

function mapFileEntry(entry: OpencodeFileSearchEntry): MentionFileEntry {
  return { path: entry.path, mime: entry.mime };
}

function mapAgentEntry(entry: OpencodeAgentEntry): MentionAgentEntry {
  return { id: entry.id, name: entry.name };
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
    message: "opencode mention search",
    metadata: {
      kind: "opencode.mention.search",
      reason: input.reason,
      workspaceRootPath: input.workspaceRootPath,
      error: input.error instanceof Error ? input.error.message : undefined,
    },
  });
}

/**
 * Searches files (`fs.find`) for the given query. Returns an empty list on
 * transport / auth errors so the picker degrades to agent-only matches.
 */
export async function searchMentionFiles(input: {
  workspaceRootPath: string;
  query: string;
  limit?: number;
}): Promise<{ status: MentionSearchStatus; files: MentionFileEntry[] }> {
  const trimmed = input.query.trim();
  if (trimmed.length === 0) {
    return { status: "idle", files: [] };
  }
  const backend = createOpencodeBackendFromAppState();
  if (!backend) {
    return { status: "idle", files: [] };
  }
  try {
    const entries = await backend.findFiles({
      workspaceRootPath: input.workspaceRootPath,
      query: trimmed,
      ...(input.limit ? { limit: input.limit } : {}),
    });
    return { status: "loaded", files: entries.map(mapFileEntry) };
  } catch (error: unknown) {
    emitDiagnostic({
      reason: "error",
      workspaceRootPath: input.workspaceRootPath,
      level: "warn",
      error,
    });
    return { status: "error", files: [] };
  }
}

/**
 * Builds the full mention result set for a query by combining a file search
 * with a client-side filter over the supplied agent list. `agents` should be
 * the pre-loaded OpenCode catalog agents (kept in memory; no per-keystroke
 * server call).
 */
export function filterMentionAgents(
  agents: readonly OpencodeAgentEntry[],
  query: string,
): MentionAgentEntry[] {
  const trimmed = query.trim().toLowerCase();
  const mapped = agents.map(mapAgentEntry);
  if (trimmed.length === 0) {
    return mapped;
  }
  return mapped.filter(
    (agent) =>
      agent.id.toLowerCase().includes(trimmed) ||
      agent.name.toLowerCase().includes(trimmed),
  );
}

/**
 * Returns `true` when the cursor should trigger the `@` mention picker. Mirrors
 * the slash popover: an `@` at the start of input or after whitespace, followed
 * by non-whitespace chars only.
 */
export function shouldTriggerMentionPicker(value: string, caret: number): {
  trigger: boolean;
  query: string;
} {
  if (caret < 0 || caret > value.length) {
    return { trigger: false, query: "" };
  }
  const upToCaret = value.slice(0, caret);
  const match = /(?:^|\s)@(\S*)$/.exec(upToCaret);
  if (!match) {
    return { trigger: false, query: "" };
  }
  return { trigger: true, query: match[1] ?? "" };
}

/** Token shape the composer stores per inserted mention. */
export interface MentionToken {
  kind: "file" | "agent";
  /** `@file:path/to/file.ts` or `@agent:name`. */
  display: string;
  /** Raw value without the `@kind:` prefix (the path or the agent id). */
  value: string;
}

export function mentionTokenForFile(path: string): MentionToken {
  return {
    kind: "file",
    display: `@file:${path}`,
    value: path,
  };
}

export function mentionTokenForAgent(id: string, name: string): MentionToken {
  return {
    kind: "agent",
    // Show the agent's human name in the chip; the id is what we send.
    display: `@agent:${name}`,
    value: id,
  };
}

/**
 * Replacement that inserts the mention token at the cursor (replacing the
 * `@<query>` the user typed). Followed by a trailing space so the user can
 * keep typing.
 */
export function buildMentionReplacement(input: {
  value: string;
  caret: number;
  token: MentionToken;
}): { value: string; caret: number } {
  const { value, caret, token } = input;
  const upToCaret = value.slice(0, caret);
  const rest = value.slice(caret);
  const atIndex = upToCaret.lastIndexOf("@");
  if (atIndex < 0) {
    const sep = value.length > 0 && !value.endsWith(" ") ? " " : "";
    const next = `${value}${sep}${token.display} `;
    return { value: next, caret: next.length };
  }
  const charBefore = atIndex === 0 ? "" : value[atIndex - 1];
  if (charBefore && !/\s/.test(charBefore)) {
    const sep = value.length > 0 && !value.endsWith(" ") ? " " : "";
    const next = `${value}${sep}${token.display} `;
    return { value: next, caret: next.length };
  }
  const before = value.slice(0, atIndex);
  const next = `${before}${token.display} ${rest}`;
  const nextCaret = (before + token.display + " ").length;
  return { value: next, caret: nextCaret };
}
