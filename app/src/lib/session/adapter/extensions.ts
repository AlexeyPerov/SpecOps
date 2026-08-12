/**
 * Optional capability extensions (phase C, task AS01-C-02).
 *
 * The mandatory core ({@link ./adapter}) stays minimal. Every optional feature
 * is an interface an adapter MAY implement in addition to the core; the host
 * and UI down-cast via the `is*Extension` type guards. This keeps unsupported
 * actions absent or explainably-disabled without widening the core, and lets
 * runtime-specific settings extend the UI through {@link ConfigurationExtension}
 * rather than new mandatory methods.
 *
 * Capability honesty: an adapter advertises a capability id in
 * `describeCapabilities()` if and only if it implements the matching extension.
 * The shared contract suite asserts this.
 */

import type { AgentCapabilityValue } from "../capabilities";
import type { AgentModelDescriptor, AgentModeDescriptor } from "../binding";
import type { NativeSessionRef } from "./adapter";
import type { NativeSessionId, SpecOpsTurnId } from "../ids";
import type {
  DiffSnapshot,
  PermissionReply,
  PermissionRequest,
  QuestionRequest,
} from "../events";

// ---------------------------------------------------------------------------
// Catalogs — model/mode listing
// ---------------------------------------------------------------------------

export interface CatalogExtension {
  listModels(input?: { readonly workspaceRootPath?: string }): Promise<readonly AgentModelDescriptor[]>;
  listModes(input?: { readonly modelId?: string }): Promise<readonly AgentModeDescriptor[]>;
}

// ---------------------------------------------------------------------------
// Permissions + questions — replying to interactive prompts
// ---------------------------------------------------------------------------

export interface PermissionExtension {
  replyPermission(input: {
    readonly native: NativeSessionRef;
    readonly turnId: SpecOpsTurnId;
    readonly permissionId: string;
    readonly reply: PermissionReply;
  }): Promise<void>;
}

export interface QuestionExtension {
  replyQuestion(input: {
    readonly native: NativeSessionRef;
    readonly turnId: SpecOpsTurnId;
    readonly questionId: string;
    readonly answer: string;
  }): Promise<void>;
  rejectQuestion(input: {
    readonly native: NativeSessionRef;
    readonly turnId: SpecOpsTurnId;
    readonly questionId: string;
    readonly reason?: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Lifecycle — interrupt / restart
// ---------------------------------------------------------------------------

export interface LifecycleExtension {
  /** Best-effort interruption of the active turn without ending the session. */
  interrupt?(input: { readonly native: NativeSessionRef }): Promise<void>;
  /** Restart the underlying runtime process/session, returning a refreshed ref. */
  restart?(input: { readonly native: NativeSessionRef }): Promise<NativeSessionRef>;
}

// ---------------------------------------------------------------------------
// Checkpoints — fork / rewind / checkpoint / share / summarize
// ---------------------------------------------------------------------------

export interface CheckpointExtension {
  forkSession(input: {
    readonly native: NativeSessionRef;
    readonly turnId?: SpecOpsTurnId;
  }): Promise<NativeSessionRef>;
  rewind?(input: {
    readonly native: NativeSessionRef;
    readonly toTurnId?: SpecOpsTurnId;
  }): Promise<void>;
  checkpoint?(input: {
    readonly native: NativeSessionRef;
    readonly label?: string;
  }): Promise<{ readonly checkpointId: string }>;
}

export interface ShareExtension {
  shareSession(input: { readonly native: NativeSessionRef }): Promise<{ readonly url: string }>;
  summarize?(input: { readonly native: NativeSessionRef }): Promise<{ readonly summary: string }>;
}

// ---------------------------------------------------------------------------
// Configuration — runtime-specific settings that extend the UI
// ---------------------------------------------------------------------------

export interface AgentConfigurationField {
  readonly id: string;
  readonly label: string;
  readonly kind: "string" | "number" | "boolean" | "select";
  readonly options?: readonly string[];
  readonly default?: unknown;
  readonly secret?: boolean;
  readonly description?: string;
}

export interface AgentConfigurationSchema {
  readonly schemaVersion: number;
  readonly fields: readonly AgentConfigurationField[];
}

export interface ConfigurationExtension {
  describeConfiguration(input?: {
    readonly workspaceRootPath?: string;
  }): Promise<AgentConfigurationSchema>;
  applyConfiguration(input: {
    readonly workspaceRootPath: string;
    readonly values: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// MCP / skills / commands — runtime-side tooling surfaces
// ---------------------------------------------------------------------------

export interface McpServerEntry {
  readonly id: string;
  readonly name?: string;
  readonly status?: string;
}

export interface McpExtension {
  listMcpServers(input?: { readonly workspaceRootPath?: string }): Promise<readonly McpServerEntry[]>;
}

export interface SkillEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
}

export interface SkillsExtension {
  listSkills(input?: { readonly workspaceRootPath?: string }): Promise<readonly SkillEntry[]>;
}

export interface CommandEntry {
  readonly id: string;
  readonly template?: string;
  readonly description?: string;
}

export interface CommandsExtension {
  listCommands(input?: { readonly workspaceRootPath?: string }): Promise<readonly CommandEntry[]>;
}

// ---------------------------------------------------------------------------
// Todos / diffs / diagnostics — auxiliary surfaces
// ---------------------------------------------------------------------------

export interface NativeTodoEntry {
  readonly id: string;
  readonly content: string;
  readonly status: "pending" | "in_progress" | "completed";
}

export interface TodosExtension {
  listTodos(input: { readonly native: NativeSessionRef }): Promise<readonly NativeTodoEntry[]>;
}

export interface DiffsExtension {
  listDiffs(input: { readonly native: NativeSessionRef }): Promise<readonly DiffSnapshot[]>;
}

export interface DiagnosticsEntry {
  readonly nativeSessionId: NativeSessionId;
  readonly seq: number;
  readonly at: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly redactedRaw?: unknown;
}

export interface DiagnosticsExtension {
  collectDiagnostics(input: {
    readonly native: NativeSessionRef;
    readonly sinceSeq?: number;
  }): Promise<readonly DiagnosticsEntry[]>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

type AdapterLike = unknown;

function hasMethod(value: AdapterLike, name: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[name] === "function"
  );
}

export function isCatalogExtension(adapter: AdapterLike): adapter is CatalogExtension {
  return hasMethod(adapter, "listModels") && hasMethod(adapter, "listModes");
}

export function isPermissionExtension(adapter: AdapterLike): adapter is PermissionExtension {
  return hasMethod(adapter, "replyPermission");
}

export function isQuestionExtension(adapter: AdapterLike): adapter is QuestionExtension {
  return hasMethod(adapter, "replyQuestion");
}

export function isLifecycleExtension(adapter: AdapterLike): adapter is LifecycleExtension {
  return hasMethod(adapter, "interrupt") || hasMethod(adapter, "restart");
}

export function isCheckpointExtension(adapter: AdapterLike): adapter is CheckpointExtension {
  return hasMethod(adapter, "forkSession");
}

export function isShareExtension(adapter: AdapterLike): adapter is ShareExtension {
  return hasMethod(adapter, "shareSession");
}

export function isConfigurationExtension(adapter: AdapterLike): adapter is ConfigurationExtension {
  return hasMethod(adapter, "describeConfiguration") && hasMethod(adapter, "applyConfiguration");
}

export function isMcpExtension(adapter: AdapterLike): adapter is McpExtension {
  return hasMethod(adapter, "listMcpServers");
}

export function isSkillsExtension(adapter: AdapterLike): adapter is SkillsExtension {
  return hasMethod(adapter, "listSkills");
}

export function isCommandsExtension(adapter: AdapterLike): adapter is CommandsExtension {
  return hasMethod(adapter, "listCommands");
}

export function isTodosExtension(adapter: AdapterLike): adapter is TodosExtension {
  return hasMethod(adapter, "listTodos");
}

export function isDiffsExtension(adapter: AdapterLike): adapter is DiffsExtension {
  return hasMethod(adapter, "listDiffs");
}

export function isDiagnosticsExtension(adapter: AdapterLike): adapter is DiagnosticsExtension {
  return hasMethod(adapter, "collectDiagnostics");
}

/**
 * Standard capability-id → required-extension map. Used by the contract suite
 * to assert capability honesty (advertised capability ⇒ implemented extension).
 * Open capability ids (runtime-specific) are exempt.
 */
export const CAPABILITY_EXTENSION_MAP: Readonly<Record<string, (a: AdapterLike) => boolean>> = {
  permissions: isPermissionExtension,
  questions: isQuestionExtension,
  fork: isCheckpointExtension,
  rewind: (a) => isCheckpointExtension(a) && typeof a.rewind === "function",
  checkpoint: (a) => isCheckpointExtension(a) && typeof a.checkpoint === "function",
  share: isShareExtension,
  summarize: (a) => isShareExtension(a) && typeof a.summarize === "function",
  mcp: isMcpExtension,
  skills: isSkillsExtension,
  commands: isCommandsExtension,
};

/**
 * Return the list of standardized capability ids an adapter satisfies based on
 * the extensions it implements. Useful for adapters to compute their
 * `describeCapabilities()` result honestly.
 */
export function inferCapabilities(adapter: AdapterLike): AgentCapabilityValue[] {
  const out: AgentCapabilityValue[] = [];
  for (const [capability, check] of Object.entries(CAPABILITY_EXTENSION_MAP)) {
    if (check(adapter)) {
      out.push(capability as AgentCapabilityValue);
    }
  }
  if (isTodosExtension(adapter)) out.push("nativeTodos");
  if (hasMethod(adapter, "describeConfiguration")) {
    // configuration is not a standalone capability id; surfaced via extension only.
  }
  return out;
}

export type {
  PermissionReply,
  PermissionRequest,
  QuestionRequest,
  DiffSnapshot,
};
