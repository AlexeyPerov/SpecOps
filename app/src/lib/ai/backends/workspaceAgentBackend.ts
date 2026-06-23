import { ensureOpencodeSidecar } from "../../services/opencodeSidecarEnsure";
import type { OpencodeTransportMode } from "../../domain/contracts";
import { logDiagnostic } from "../../services/logging";
import { loadOpencodeServerPassword } from "../../services/providerSecretsStore";
import {
  createOpencodeClient as createOpencodeSdkClient,
  type OpencodeClient as OpencodeSdkClient,
} from "@opencode-ai/sdk/v2/client";
import {
  readBoolean,
  readNumber,
  readObject,
  readString,
  readTokenUsage,
} from "./wireReaders";

export type WorkspaceAgentBackendId = "opencode" | "cursor-local";

/** Optional context payload assembled by the composer (M3). Mentions and
 * attachments are forwarded to OpenCode as `parts` on the prompt; the bare
 * `prompt` text still goes through as a `text` part. */
export interface WorkspaceAgentSendAttachment {
  mime: string;
  filename?: string;
  url: string;
}

export interface WorkspaceAgentSendContext {
  /** File paths mentioned via `@file:…` — appended as context text. */
  filePaths?: string[];
  /** Agent names mentioned via `@agent:…` — forwarded as `agent` parts. */
  agentNames?: string[];
  /** File attachments (drag-and-drop / file picker). */
  attachments?: WorkspaceAgentSendAttachment[];
}

export interface WorkspaceAgentSendRequest {
  prompt: string;
  workspaceRootPath: string;
  sessionId: string;
  model?: string;
  agent?: string;
  provider?: string;
  /** Composer-assembled context (M3-T1..T3). Optional — bare prompts omit it. */
  context?: WorkspaceAgentSendContext;
}

/** Slash command returned by `command.list` (M3-T1). Maps OpenCode's
 * `CommandV2Info` (and the legacy `Command`) shape; tolerates either. */
export interface OpencodeCommandEntry {
  name: string;
  template: string;
  description?: string;
  agent?: string;
  subtask?: boolean;
}

/** Filesystem entry returned by `fs.find` (M3-T2). */
export interface OpencodeFileSearchEntry {
  path: string;
  type: "file" | "directory";
  mime: string;
}

export interface WorkspaceAgentSession {
  id: string;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkspaceAgentRunResult {
  sessionId: string;
}

/**
 * Rich session view — what `session.list` / `session.get` / `session.fork` /
 * `session.revert` actually return. Carries the OpenCode `Session`-shape fields
 * the lifecycle UI (M2) needs that the minimal `WorkspaceAgentSession` does not:
 * share URL, parent / fork lineage, revert preview, cost snapshot, and an
 * optional title derived from the message summary. `title` is non-null here
 * because OpenCode always returns a string (may be empty) — callers normalize.
 */
export interface WorkspaceAgentSessionDetails {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** OpenCode session this one was forked from, if any. */
  parentId: string | null;
  /** Public share URL set by `session.share`, if any. */
  shareUrl: string | null;
  /** Cumulative cost (USD) snapshot from OpenCode, if any. */
  cost: number | null;
  /** Revert preview attached after a `session.revert`, if any. */
  revert: WorkspaceAgentSessionRevert | null;
}

export interface WorkspaceAgentSessionRevert {
  messageId: string;
  partId: string | null;
  /** Unified diff of file changes the revert would undo. */
  diff: string | null;
  /** Snapshot id the revert restored to, if any. */
  snapshot: string | null;
}

/** Raw OpenCode session.messages entry: { info, parts }. */
export interface OpencodeSessionMessageEntry {
  info: unknown;
  parts: unknown;
}

export type WorkspacePermissionReply = "once" | "always" | "reject";

export interface WorkspacePermissionReplyRequest {
  workspaceRootPath: string;
  sessionId: string;
  requestId: string;
  reply: WorkspacePermissionReply;
  message?: string;
}

export interface WorkspaceQuestionReplyRequest {
  workspaceRootPath: string;
  sessionId: string;
  requestId: string;
  answers: string[][];
}

export interface WorkspaceQuestionRejectRequest {
  workspaceRootPath: string;
  sessionId: string;
  requestId: string;
  message?: string;
}

export interface OpencodeModelEntry {
  id: string;
  name: string;
  providerId?: string;
}

export interface OpencodeProviderEntry {
  id: string;
  name: string;
}

export interface OpencodeAgentEntry {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// M4 — Configuration management types.
//
// These are deliberately loose (`Record<string, unknown>` for nested config
// blobs) rather than mirroring the OpenCode `Config` type verbatim. OpenCode's
// config schema is large and evolves; we read/write the known top-level keys
// (model, small_model, username, share, etc.) with typed helpers in
// `opencodeConfig.ts` and treat everything else as an opaque JSON object the
// raw-JSON tab can still edit. This keeps the backend contract stable across
// SDK releases.
// ---------------------------------------------------------------------------

/** Raw OpenCode config document — the body of `config.get` / `config.update`. */
export type OpencodeConfigDocument = Record<string, unknown>;

/** A configured slash command entry from the `command:` config key (M4-T6). */
export interface OpencodeCommandConfigEntry {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  variant?: string;
  subtask?: boolean;
}

/** Agent definition from the `agent:` config key (M4-T4). */
export interface OpencodeAgentConfigEntry {
  model?: string;
  variant?: string;
  temperature?: number;
  topP?: number;
  prompt?: string;
  tools?: Record<string, boolean>;
  disable?: boolean;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  color?: string;
  steps?: number;
  maxSteps?: number;
  permission?: OpencodePermissionConfig;
}

/** Permission config shape — either a single action or a per-tool map (M4-T5). */
export type OpencodePermissionConfig =
  | "allow"
  | "deny"
  | "ask"
  | Record<string, unknown>;

/** Permission rule row for the visual editor (M4-T5). */
export interface OpencodePermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
}

/** Provider entry enriched with auth + model info (M4-T2). */
export interface OpencodeProviderStatus {
  id: string;
  name: string;
  connected: boolean;
  /** Number of models the provider exposes (best-effort count). */
  modelCount: number;
  source?: string;
}

/** Provider auth method descriptor (M4-T2). */
export interface OpencodeProviderAuthMethod {
  type: "oauth" | "api";
  label: string;
}

/** MCP server status entry (M4-T3). */
export interface OpencodeMcpStatusEntry {
  name: string;
  status:
    | "connected"
    | "disabled"
    | "failed"
    | "needs_auth"
    | "needs_client_registration";
  /** Error message present on `failed` / `needs_client_registration` statuses. */
  error?: string;
  /** Connection type when discoverable from config; null when unknown. */
  type?: "local" | "remote";
  enabled: boolean;
}

/** Local (stdio) MCP server config (M4-T3). */
export interface OpencodeMcpLocalConfig {
  type: "local";
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

/** Remote (HTTP/SSE) MCP server config (M4-T3). */
export interface OpencodeMcpRemoteConfig {
  type: "remote";
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  oauth?: Record<string, unknown> | false;
  timeout?: number;
}

export type OpencodeMcpConfig = OpencodeMcpLocalConfig | OpencodeMcpRemoteConfig;

/** Discovered skill entry (M4-T7). */
export interface OpencodeSkillEntry {
  name: string;
  description?: string;
  location: string;
}

// ---------------------------------------------------------------------------
// M5 — Workspace UX types (TODO, diff, file status, LSP).
//
// These mirror the OpenCode v2 endpoints `session.todo`, `session.diff`,
// `file.status`, and `lsp` (`/lsp`). The shapes are deliberately tolerant:
// OpenCode evolves its payloads between releases, so the mappers coerce
// optional fields and fall back to safe defaults rather than failing the
// whole panel when one field is missing.
// ---------------------------------------------------------------------------

/** A single TODO entry from `session.todo` (the agent's `todowrite` list). */
export interface OpencodeTodoEntry {
  content: string;
  status: OpencodeTodoStatus;
  priority: OpencodeTodoPriority;
}

export type OpencodeTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type OpencodeTodoPriority = "high" | "medium" | "low";

/** A single changed file from `session.diff` (the `SnapshotFileDiff` shape). */
export interface OpencodeSessionFileDiff {
  /** Workspace-relative file path. */
  file: string;
  /** Unified-diff patch (may be empty for binary / new files). */
  patch: string;
  additions: number;
  deletions: number;
  status: OpencodeFileChangeStatus;
}

export type OpencodeFileChangeStatus = "added" | "deleted" | "modified";

/** File status entry from `file.status` (the `File` shape: git working tree). */
export interface OpencodeFileStatusEntry {
  path: string;
  additions: number;
  deletions: number;
  status: OpencodeFileChangeStatus;
}

/** LSP server entry from `lsp` (`/lsp`). */
export interface OpencodeLspStatusEntry {
  id: string;
  name: string;
  root: string;
  status: "connected" | "error";
}

export type WorkspaceAgentStreamEvent =
  | {
      type: "message.delta";
      delta: string;
    }
  | {
      type: "message.completed";
      message: string;
    }
  | {
      type: "reasoning.delta";
      reasoningId: string | null;
      delta: string;
    }
  | {
      type: "reasoning.ended";
      reasoningId: string | null;
      text: string;
    }
  | {
      type: "subtask.started";
      subtaskId: string | null;
      agent: string;
      description: string | null;
      prompt: string | null;
    }
  | {
      type: "step.started";
      stepId: string | null;
      agent: string | null;
      modelId: string | null;
      providerId: string | null;
    }
  | {
      type: "step.finished";
      stepId: string | null;
      reason: string | null;
      cost: number;
      tokens: WorkspaceAgentTokenUsage;
    }
  | {
      type: "step.failed";
      stepId: string | null;
      message: string;
    }
  | {
      type: "tool.started";
      toolName: string;
      callId: string | null;
      input: unknown;
    }
  | {
      type: "tool.completed";
      toolName: string;
      callId: string | null;
      output: unknown;
      isError: boolean;
    }
  | {
      type: "tool.progress";
      toolName: string;
      callId: string | null;
      output: unknown;
    }
  | {
      type: "permission.requested";
      permissionId: string;
      label: string;
      payload: unknown;
    }
  | {
      type: "question.requested";
      questionId: string;
      prompt: string;
      choices: string[];
      payload: unknown;
    }
  | {
      type: "run.completed";
    }
  | {
      type: "run.failed";
      message: string;
    };

export interface WorkspaceAgentTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

export type WorkspaceAgentBackendErrorCode =
  | "authFailure"
  | "serverUnavailable"
  | "transportError"
  | "invalidDirectory"
  | "invalidResponse"
  | "notFound";

export class WorkspaceAgentBackendError extends Error {
  readonly code: WorkspaceAgentBackendErrorCode;

  readonly status: number | null;

  readonly causeValue: unknown;

  constructor(input: {
    code: WorkspaceAgentBackendErrorCode;
    message: string;
    status?: number | null;
    cause?: unknown;
  }) {
    super(input.message);
    this.name = "WorkspaceAgentBackendError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.causeValue = input.cause;
  }
}

export interface WorkspaceAgentBackend {
  readonly id: WorkspaceAgentBackendId;
  createSession(input: {
    workspaceRootPath: string;
    title?: string;
  }): Promise<WorkspaceAgentSession>;
  getSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSession | null>;
  /**
   * Full `Session` view for one session (M2). Carries share URL, parent /
   * fork lineage, revert preview, and cost snapshot that the minimal
   * `getSession` deliberately drops.
   */
  getSessionDetails(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails | null>;
  listSessions(input: { workspaceRootPath: string }): Promise<WorkspaceAgentSession[]>;
  /**
   * Rich session list for the unified per-workspace session panel (M2-T2).
   * `?directory=` is forwarded so OpenCode filters to this workspace's
   * sessions (matches `listSessions`, but returns the richer shape that
   * carries share / fork / cost metadata).
   */
  listSessionDetails(input: {
    workspaceRootPath: string;
    search?: string;
    limit?: number;
  }): Promise<WorkspaceAgentSessionDetails[]>;
  deleteSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<boolean>;
  send(request: WorkspaceAgentSendRequest): Promise<WorkspaceAgentRunResult>;
  replyPermission(input: WorkspacePermissionReplyRequest): Promise<void>;
  replyQuestion(input: WorkspaceQuestionReplyRequest): Promise<void>;
  rejectQuestion(input: WorkspaceQuestionRejectRequest): Promise<void>;
  abortSession(input: { workspaceRootPath: string; sessionId: string }): Promise<void>;
  streamEvents(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): AsyncIterable<WorkspaceAgentStreamEvent>;
  listMessages(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<OpencodeSessionMessageEntry[]>;
  /**
   * Rename / archive a session (M2-T1). `session.update` only the title for
   * now — archive / permission / metadata are out of scope.
   */
  updateSessionTitle(input: {
    workspaceRootPath: string;
    sessionId: string;
    title: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Fork a session from a message (M2-T3). Returns the new child session's
   * details so the UI can open a fresh agent tab linked to it.
   */
  forkSession(input: {
    workspaceRootPath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Revert a session to a message in-place (M2-T4 undo). Returns the updated
   * session carrying the revert preview (diff / snapshot).
   */
  revertSession(input: {
    workspaceRootPath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Restore a previously-reverted session in-place (M2-T4 redo).
   */
  unrevertSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Create a public share URL for a session (M2-T5). Returns the updated
   * session carrying `shareUrl`.
   */
  shareSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Remove a session's share URL (M2-T5).
   */
  unshareSession(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails>;
  /**
   * Generate / refresh a session summary (M2-T6). Resolves `true` when
   * OpenCode produced a summary; the summary text arrives on subsequent
   * `session.messages` / `session.get` calls.
   */
  summarizeSession(input: {
    workspaceRootPath: string;
    sessionId: string;
    modelId?: string;
    providerId?: string;
  }): Promise<boolean>;
  /**
   * List child sessions forked from a parent (M2-T3 fork-tree navigation).
   */
  listSessionChildren(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<WorkspaceAgentSessionDetails[]>;
  listModels(input: { workspaceRootPath: string }): Promise<OpencodeModelEntry[]>;
  listProviders(input: { workspaceRootPath: string }): Promise<OpencodeProviderEntry[]>;
  listAgents(input: { workspaceRootPath: string }): Promise<OpencodeAgentEntry[]>;
  /**
   * List slash commands for the workspace (M3-T1). Forwards to
   * `command.list`; tolerates both the v1 `/command` and v2 `/api/command`
   * shapes.
   */
  listCommands(input: { workspaceRootPath: string }): Promise<OpencodeCommandEntry[]>;
  /**
   * Find files in the workspace for `@` mentions (M3-T2). Forwards `query`
   * to `fs.find` and returns ranked file entries.
   */
  findFiles(input: {
    workspaceRootPath: string;
    query: string;
    limit?: number;
  }): Promise<OpencodeFileSearchEntry[]>;
  // -------------------------------------------------------------------------
  // M4 — Configuration management. The config lifecycle is read (`config.get`)
  // → local edit → write (`config.update`). Provider / MCP / agent / skill
  // helpers wrap their dedicated endpoints; config-backed ones (agents,
  // commands, permissions, instructions) funnel through `updateConfig`.
  // -------------------------------------------------------------------------
  /**
   * Read the OpenCode config document for the workspace (M4-T1). Forwards to
   * `config.get` and unwraps the `.data` payload.
   */
  getConfig(input: { workspaceRootPath: string }): Promise<OpencodeConfigDocument>;
  /**
   * Replace the OpenCode config document (M4-T1). Forwards the full document
   * to `config.update`. Callers should read → mutate → write to avoid clobbering
   * keys they don't render form fields for.
   */
  updateConfig(input: {
    workspaceRootPath: string;
    config: OpencodeConfigDocument;
  }): Promise<OpencodeConfigDocument>;
  /**
   * List providers with connection + model-count info (M4-T2). Merges
   * `provider.list` (which carries `all` + `connected`) with optional model
   * counts from `config.providers`.
   */
  listProviderStatuses(input: {
    workspaceRootPath: string;
  }): Promise<OpencodeProviderStatus[]>;
  /**
   * Set a provider's API key (M4-T2). Stores the key in the OpenCode config /
   * auth store via `auth.set`; SpecOps never persists provider keys itself.
   */
  setProviderApiKey(input: {
    workspaceRootPath: string;
    providerId: string;
    apiKey: string;
  }): Promise<boolean>;
  /**
   * Remove a provider's stored credentials (M4-T2).
   */
  removeProviderAuth(input: {
    workspaceRootPath: string;
    providerId: string;
  }): Promise<boolean>;
  /**
   * Start a provider OAuth flow (M4-T2). Returns the auth URL the caller should
   * open in a browser; the flow completes via `completeProviderOAuth` with the
   * code from the callback redirect.
   */
  startProviderOAuth(input: {
    workspaceRootPath: string;
    providerId: string;
  }): Promise<string | null>;
  /**
   * Complete a provider OAuth flow with the returned code (M4-T2).
   */
  completeProviderOAuth(input: {
    workspaceRootPath: string;
    providerId: string;
    code?: string;
  }): Promise<boolean>;
  /**
   * List MCP servers with connection status (M4-T3). Forwards to `mcp.status`.
   */
  listMcpStatuses(input: {
    workspaceRootPath: string;
  }): Promise<OpencodeMcpStatusEntry[]>;
  /**
   * Add an MCP server (M4-T3). Forwards name + config to `mcp.add`.
   */
  addMcpServer(input: {
    workspaceRootPath: string;
    name: string;
    config: OpencodeMcpConfig;
  }): Promise<OpencodeMcpStatusEntry[]>;
  /**
   * Connect a configured MCP server (M4-T3).
   */
  connectMcpServer(input: {
    workspaceRootPath: string;
    name: string;
  }): Promise<boolean>;
  /**
   * Disconnect an MCP server (M4-T3).
   */
  disconnectMcpServer(input: {
    workspaceRootPath: string;
    name: string;
  }): Promise<boolean>;
  /**
   * List discovered skills for the workspace (M4-T7). Forwards to `app.skills`.
   */
  listSkills(input: { workspaceRootPath: string }): Promise<OpencodeSkillEntry[]>;
  /**
   * List enriched agents (built-in + custom) for the agent management panel
   * (M4-T4). Forwards to `app.agents` and maps the richer `Agent` shape.
   */
  listAgentDetails(input: {
    workspaceRootPath: string;
  }): Promise<OpencodeAgentDetail[]>;
  // -------------------------------------------------------------------------
  // M5 — Workspace UX. Session-scoped data (todo, diff) require a sessionId;
  // workspace-scoped data (file.status, lsp) only need the workspace root.
  // All degrade to `[]` on transport / notFound errors so the panels never
  // block on a flaky server — they just render "no data".
  // -------------------------------------------------------------------------
  /**
   * Fetch the agent's TODO list for a session (M5-T1). Forwards to
   * `session.todo`; returns the `Todo[]` payload normalized to
   * `OpencodeTodoEntry[]`.
   */
  listSessionTodos(input: {
    workspaceRootPath: string;
    sessionId: string;
  }): Promise<OpencodeTodoEntry[]>;
  /**
   * Fetch the file-change diff for a session (M5-T2). Forwards to
   * `session.diff`; pass `messageId` to scope to a single message. Returns
   * the `SnapshotFileDiff[]` payload normalized to
   * `OpencodeSessionFileDiff[]`.
   */
  listSessionDiffs(input: {
    workspaceRootPath: string;
    sessionId: string;
    messageId?: string;
  }): Promise<OpencodeSessionFileDiff[]>;
  /**
   * Fetch the workspace git status (M5-T3). Forwards to `file.status`;
   * returns the `File[]` payload (added/removed/status) used to badge the
   * project tree.
   */
  listFileStatuses(input: {
    workspaceRootPath: string;
  }): Promise<OpencodeFileStatusEntry[]>;
  /**
   * Fetch the LSP server status for the workspace (M5-T4). Forwards to
   * `lsp` (`/lsp`); returns the `LspStatus[]` payload.
   */
  listLspStatuses(input: {
    workspaceRootPath: string;
  }): Promise<OpencodeLspStatusEntry[]>;
}

/**
 * Rich agent descriptor for the agent management panel (M4-T4). Maps the
 * OpenCode `Agent` shape (from `app.agents`); built-in agents have
 * `builtin: true` and cannot be deleted.
 */
export interface OpencodeAgentDetail {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  builtin: boolean;
  hidden?: boolean;
  color?: string;
  model?: { modelId: string; providerId: string };
  variant?: string;
  prompt?: string;
  steps?: number;
  /** Permission ruleset summary (count of rules) — full editing via config. */
  permissionRuleCount: number;
}

export class WorkspaceAgentBackendNotImplementedError extends Error {
  constructor(backendId: WorkspaceAgentBackendId) {
    super(
      `Workspace agent backend "${backendId}" is not implemented yet. Planned for phase 5.`,
    );
    this.name = "WorkspaceAgentBackendNotImplementedError";
  }
}

interface OpencodeRuntimeConfig {
  mode: OpencodeTransportMode;
  baseUrl: string;
}

export interface RawOpencodeClient {
  createSession(input: { title?: string }): Promise<unknown>;
  getSession(input: { sessionId: string }): Promise<unknown>;
  listSessions(input?: { directory?: string; search?: string; limit?: number }): Promise<unknown>;
  deleteSession(input: { sessionId: string }): Promise<unknown>;
  sendPrompt(input: {
    sessionId: string;
    prompt: string;
    model?: string;
    agent?: string;
    provider?: string;
    context?: WorkspaceAgentSendContext;
  }): Promise<unknown>;
  replyPermission(input: {
    sessionId: string;
    requestId: string;
    reply: WorkspacePermissionReply;
    message?: string;
  }): Promise<unknown>;
  replyQuestion(input: { sessionId: string; requestId: string; answers: string[][] }): Promise<unknown>;
  rejectQuestion(input: { sessionId: string; requestId: string; message?: string }): Promise<unknown>;
  abortSession(input: { sessionId: string }): Promise<unknown>;
  streamEvents(input: { sessionId: string }): AsyncIterable<unknown>;
  listMessages(input: { sessionId: string }): Promise<OpencodeSessionMessageEntry[]>;
  updateSession(input: { sessionId: string; title?: string }): Promise<unknown>;
  forkSession(input: { sessionId: string; messageId?: string }): Promise<unknown>;
  revertSession(input: { sessionId: string; messageId?: string }): Promise<unknown>;
  unrevertSession(input: { sessionId: string }): Promise<unknown>;
  shareSession(input: { sessionId: string }): Promise<unknown>;
  unshareSession(input: { sessionId: string }): Promise<unknown>;
  summarizeSession(input: {
    sessionId: string;
    modelId?: string;
    providerId?: string;
  }): Promise<unknown>;
  listSessionChildren(input: { sessionId: string }): Promise<unknown>;
  listModels(): Promise<unknown>;
  listProviders(): Promise<unknown>;
  listAgents(): Promise<unknown>;
  listCommands(): Promise<unknown>;
  findFiles(input: { query: string; limit?: number }): Promise<unknown>;
  // M4 — config / provider / mcp / app endpoints
  getConfig(): Promise<unknown>;
  updateConfig(config: OpencodeConfigDocument): Promise<unknown>;
  listProviderStatuses(): Promise<unknown>;
  listProviderAuthMethods(): Promise<unknown>;
  setProviderAuth(providerId: string, apiKey: string): Promise<unknown>;
  removeProviderAuth(providerId: string): Promise<unknown>;
  startProviderOAuth(providerId: string): Promise<unknown>;
  completeProviderOAuth(providerId: string, code?: string): Promise<unknown>;
  listMcpStatuses(): Promise<unknown>;
  addMcpServer(name: string, config: OpencodeMcpConfig): Promise<unknown>;
  connectMcpServer(name: string): Promise<unknown>;
  disconnectMcpServer(name: string): Promise<unknown>;
  listSkills(): Promise<unknown>;
  listAgentDetails(): Promise<unknown>;
  // M5 — workspace UX endpoints
  listSessionTodos(input: { sessionId: string }): Promise<unknown>;
  listSessionDiffs(input: { sessionId: string; messageId?: string }): Promise<unknown>;
  listFileStatuses(): Promise<unknown>;
  listLspStatuses(): Promise<unknown>;
}

interface WorkspaceAgentBackendDependencies {
  resolveRuntimeConfig?: () => Promise<OpencodeRuntimeConfig>;
  resolveServerPassword?: () => Promise<string>;
  createOpencodeClient?: (input: {
    baseUrl: string;
    workspaceRootPath: string;
    serverPassword: string;
  }) => RawOpencodeClient;
  /**
   * M13.5 — intent passed to `ensureOpencodeSidecar` from the central sidecar
   * service. Defaults to `"settings"` (most callers are user-driven Settings
   * or Send paths that may spawn). Background reconcile / hydrate / catalog
   * prefetch callers pass `"background-sync"` so they never spawn.
   */
  ensureIntent?: "send" | "settings" | "background-sync" | "status-only";
}

const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";

function assertWorkspaceRootPath(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new WorkspaceAgentBackendError({
      code: "invalidDirectory",
      message: "Workspace root path is required to use OpenCode backend.",
    });
  }
  return normalized;
}

function mapSession(raw: unknown): WorkspaceAgentSession {
  const payload = unwrapDataPayload(raw);
  const parsed = readObject(payload);
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid session payload.",
      cause: raw,
    });
  }
  const id = readString(parsed.id);
  if (!id) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode session payload is missing id.",
      cause: raw,
    });
  }
  return {
    id,
    title: readString(parsed.title),
    createdAt: readString(parsed.createdAt),
    updatedAt: readString(parsed.updatedAt),
  };
}

/**
 * Maps the rich `Session` shape returned by `session.get` / `session.list` /
 * `session.fork` / `session.revert` / `session.share` into SpecOps'
 * `WorkspaceAgentSessionDetails`. Reads from the unwrapped `.data` payload and
 * is tolerant of missing optional fields (share / parent / revert / cost).
 */
function mapSessionDetails(raw: unknown): WorkspaceAgentSessionDetails {
  const parsed = readObject(unwrapDataPayload(raw));
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid session payload.",
      cause: raw,
    });
  }
  const id = readString(parsed.id);
  if (!id) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode session payload is missing id.",
      cause: raw,
    });
  }
  const time = readObject(parsed.time);
  const createdAt = time ? readNumber(time.created) : null;
  const updatedAt = time ? readNumber(time.updated) : null;
  const share = readObject(parsed.share);
  const revert = readObject(parsed.revert);
  const cost = readNumber(parsed.cost);
  return {
    id,
    // OpenCode always returns a string title (may be empty); preserve verbatim.
    title: typeof parsed.title === "string" ? parsed.title : "",
    createdAt: createdAt !== null ? new Date(createdAt).toISOString() : null,
    updatedAt: updatedAt !== null ? new Date(updatedAt).toISOString() : null,
    parentId: readString(parsed.parentID) ?? readString(parsed.parentId),
    shareUrl: share ? readString(share.url) : null,
    cost: cost,
    revert: revert
      ? {
          messageId: readString(revert.messageID) ?? readString(revert.messageId) ?? "",
          partId: readString(revert.partID) ?? readString(revert.partId),
          diff: readString(revert.diff),
          snapshot: readString(revert.snapshot),
        }
      : null,
  };
}

function mapRunResult(raw: unknown, sessionId: string): WorkspaceAgentRunResult {
  const parsed = readObject(unwrapDataPayload(raw));
  if (!parsed) {
    throw new WorkspaceAgentBackendError({
      code: "invalidResponse",
      message: "OpenCode returned an invalid prompt response payload.",
      cause: raw,
    });
  }
  const resolvedSessionId =
    readString(parsed.sessionID) ?? readString(parsed.sessionId) ?? readString(parsed.id) ?? sessionId;
  return {
    sessionId: resolvedSessionId,
  };
}

interface StreamNormalizationState {
  seenEventKeys: Set<string>;
  startedToolCallKeys: Set<string>;
}

function emitStreamNormalizationDiagnostic(input: {
  reason: string;
  level?: "debug" | "warn";
  frame?: unknown;
  payload?: unknown;
  type?: string;
}): void {
  void logDiagnostic({
    level: input.level ?? "debug",
    source: "frontend",
    timestamp: new Date().toISOString(),
    message: "workspace agent stream normalization",
    metadata: {
      kind: "workspace.agent.stream.normalization",
      reason: input.reason,
      type: input.type,
      frame: input.frame,
      payload: input.payload,
    },
  });
}

function readStreamPayload(frame: Record<string, unknown>): Record<string, unknown> | null {
  return readObject(frame.data) ?? readObject(frame.properties);
}

function readFrameSessionId(
  frame: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | null {
  return (
    readString(payload.sessionID) ??
    readString(payload.sessionId) ??
    readString(frame.sessionID) ??
    readString(frame.sessionId)
  );
}

function readFrameCallId(payload: Record<string, unknown>): string | null {
  return readString(payload.callID) ?? readString(payload.callId);
}

function readFrameTimestamp(
  frame: Record<string, unknown>,
  payload: Record<string, unknown>,
): string | null {
  if (typeof payload.timestamp === "number") {
    return String(payload.timestamp);
  }
  if (typeof frame.timestamp === "number") {
    return String(frame.timestamp);
  }
  return readString(payload.timestamp) ?? readString(frame.timestamp);
}

function computeFrameDedupKey(input: {
  frame: Record<string, unknown>;
  payload: Record<string, unknown>;
  type: string;
}): string | null {
  const frameId = readString(input.frame.id);
  if (frameId) {
    return `id:${frameId}`;
  }
  const sessionId = readFrameSessionId(input.frame, input.payload);
  const callId = readFrameCallId(input.payload);
  const timestamp = readFrameTimestamp(input.frame, input.payload);
  if (!sessionId || !callId || !timestamp) {
    return null;
  }
  return `composite:${input.type}:${sessionId}:${callId}:${timestamp}`;
}

function toolCallKey(toolName: string, callId: string | null): string | null {
  if (!callId) {
    return null;
  }
  return `${toolName}:${callId}`;
}

function mapStreamFrame(
  raw: unknown,
  state: StreamNormalizationState,
): WorkspaceAgentStreamEvent[] {
  const parsedFrame = readObject(raw);
  if (!parsedFrame) {
    emitStreamNormalizationDiagnostic({
      reason: "malformed-frame",
      frame: raw,
    });
    return [];
  }
  const type = readString(parsedFrame.type);
  if (!type) {
    emitStreamNormalizationDiagnostic({
      reason: "missing-type",
      frame: raw,
    });
    return [];
  }
  const payload = readStreamPayload(parsedFrame);
  if (!payload) {
    emitStreamNormalizationDiagnostic({
      reason: "missing-payload",
      type,
      frame: raw,
    });
    return [];
  }
  const dedupKey = computeFrameDedupKey({ frame: parsedFrame, payload, type });
  if (dedupKey) {
    if (state.seenEventKeys.has(dedupKey)) {
      return [];
    }
    state.seenEventKeys.add(dedupKey);
  }
  if (type === "session.next.text.delta") {
    const delta = readString(payload.delta);
    if (!delta) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-text-delta",
        type,
        payload,
      });
      return [];
    }
    return [{ type: "message.delta", delta }];
  }
  if (type === "session.next.text.ended") {
    const message = readString(payload.text) ?? "";
    return [{ type: "message.completed", message }];
  }
  if (type === "session.next.reasoning.delta") {
    const delta = readString(payload.delta);
    if (!delta) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-reasoning-delta",
        type,
        payload,
      });
      return [];
    }
    const reasoningId = readString(payload.reasoningID) ?? readString(payload.reasoningId);
    return [{ type: "reasoning.delta", reasoningId, delta }];
  }
  if (type === "session.next.reasoning.ended") {
    const text = readString(payload.text) ?? "";
    const reasoningId = readString(payload.reasoningID) ?? readString(payload.reasoningId);
    return [{ type: "reasoning.ended", reasoningId, text }];
  }
  if (type === "session.next.step.started") {
    return [
      {
        type: "step.started",
        stepId: readString(payload.assistantMessageID) ?? readString(payload.assistantMessageId),
        agent: readString(payload.agent),
        modelId: readObject(payload.model) ? readString((payload.model as Record<string, unknown>).id) : null,
        providerId: readObject(payload.model)
          ? readString((payload.model as Record<string, unknown>).providerID) ??
            readString((payload.model as Record<string, unknown>).providerId)
          : null,
      },
    ];
  }
  if (type === "session.next.step.ended") {
    const tokens = readTokenUsage(payload.tokens);
    if (!tokens) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-step-tokens",
        type,
        payload,
      });
      return [];
    }
    const cost = readNumber(payload.cost) ?? 0;
    return [
      {
        type: "step.finished",
        stepId: readString(payload.assistantMessageID) ?? readString(payload.assistantMessageId),
        reason: readString(payload.finish) ?? readString(payload.reason),
        cost,
        tokens,
      },
    ];
  }
  if (type === "session.next.step.failed") {
    const errorObject = readObject(payload.error);
    const message =
      (errorObject ? readString(errorObject.message) : null) ??
      readString(payload.error) ??
      readString(payload.message) ??
      "Step failed.";
    return [
      {
        type: "step.failed",
        stepId: readString(payload.assistantMessageID) ?? readString(payload.assistantMessageId),
        message,
      },
    ];
  }
  if (type === "message.part.updated") {
    const part = readObject(payload.part);
    if (!part) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-part-updated",
        type,
        payload,
      });
      return [];
    }
    const partType = readString(part.type);
    if (partType !== "subtask") {
      return [];
    }
    const agent = readString(part.agent) ?? "subtask";
    return [
      {
        type: "subtask.started",
        subtaskId: readString(part.id),
        agent,
        description: readString(part.description),
        prompt: readString(part.prompt),
      },
    ];
  }
  if (type === "session.next.tool.called") {
    const toolName = readString(payload.tool) ?? readString(payload.toolName) ?? "unknown-tool";
    const callId = readFrameCallId(payload);
    const callKey = toolCallKey(toolName, callId);
    if (callKey) {
      state.startedToolCallKeys.add(callKey);
    }
    return [
      {
        type: "tool.started",
        toolName,
        callId,
        input: payload.input ?? null,
      },
    ];
  }
  if (type === "session.next.tool.progress") {
    const toolName = readString(payload.tool) ?? readString(payload.toolName) ?? "unknown-tool";
    return [
      {
        type: "tool.progress",
        toolName,
        callId: readFrameCallId(payload),
        output: payload.progress ?? payload.output ?? payload.result ?? payload.content ?? payload,
      },
    ];
  }
  if (type === "session.next.tool.success" || type === "session.next.tool.failed") {
    const isError = type === "session.next.tool.failed";
    const toolName = readString(payload.tool) ?? readString(payload.toolName) ?? "unknown-tool";
    const callId = readFrameCallId(payload);
    const callKey = toolCallKey(toolName, callId);
    const events: WorkspaceAgentStreamEvent[] = [];
    if (callKey && !state.startedToolCallKeys.has(callKey)) {
      events.push({
        type: "tool.started",
        toolName,
        callId,
        input: null,
      });
      state.startedToolCallKeys.add(callKey);
    }
    events.push({
      type: "tool.completed",
      toolName,
      callId,
      output: isError ? payload.error ?? payload.result ?? null : payload.result ?? payload.content ?? null,
      isError,
    });
    return events;
  }
  if (type === "permission.v2.asked") {
    const permissionId = readString(payload.id);
    const label = readString(payload.action) ?? readString(payload.permission);
    if (!permissionId || !label) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-permission-request",
        type,
        payload,
      });
      return [];
    }
    return [
      {
        type: "permission.requested",
        permissionId,
        label,
        payload,
      },
    ];
  }
  if (type === "question.v2.asked") {
    const questionId = readString(payload.id);
    const prompt = readQuestionPrompt(payload);
    if (!questionId || !prompt) {
      emitStreamNormalizationDiagnostic({
        reason: "malformed-question-request",
        type,
        payload,
      });
      return [];
    }
    const choices = readQuestionChoices(payload);
    return [
      {
        type: "question.requested",
        questionId,
        prompt,
        choices,
        payload,
      },
    ];
  }
  if (type === "session.idle") {
    return [{ type: "run.completed" }];
  }
  if (type === "session.status") {
    const status = readObject(payload.status);
    const statusType = readString(status?.type) ?? readString(payload.type);
    if (statusType === "idle") {
      return [{ type: "run.completed" }];
    }
    return [];
  }
  if (type === "session.error") {
    const errorObject = readObject(payload.error);
    const message =
      (errorObject ? readString(errorObject.message) : null) ??
      readString(payload.error) ??
      readString(payload.message) ??
      readString(payload.text) ??
      "OpenCode session failed.";
    emitStreamNormalizationDiagnostic({
      reason: "session-failed",
      level: "warn",
      type,
      payload,
    });
    return [{ type: "run.failed", message }];
  }
  emitStreamNormalizationDiagnostic({
    reason: "unknown-event-type",
    type,
    payload,
  });
  return [];
}

function mapHttpError(status: number, detail: string): WorkspaceAgentBackendError {
  if (status === 401 || status === 403) {
    return new WorkspaceAgentBackendError({
      code: "authFailure",
      status,
      message: detail || "OpenCode authentication failed. Check server password and retry.",
    });
  }
  if (status === 404) {
    return new WorkspaceAgentBackendError({
      code: "notFound",
      status,
      message: detail || "OpenCode resource was not found.",
    });
  }
  if (status === 400 && detail.toLowerCase().includes("directory")) {
    return new WorkspaceAgentBackendError({
      code: "invalidDirectory",
      status,
      message: detail || "OpenCode rejected the workspace directory.",
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new WorkspaceAgentBackendError({
      code: "serverUnavailable",
      status,
      message: detail || "OpenCode server is unavailable.",
    });
  }
  return new WorkspaceAgentBackendError({
    code: "transportError",
    status,
    message: detail || `OpenCode request failed with HTTP ${status}.`,
  });
}

function unwrapDataPayload(raw: unknown): unknown {
  const parsed = readObject(raw);
  if (!parsed) {
    return raw;
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "data")) {
    return parsed.data;
  }
  return raw;
}

function unwrapSessionList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data;
  }
  return null;
}

/**
 * Coerces the OpenCode `session.summarize` response to a success boolean.
 *
 * The SDK historically returns `true` or the string `"true"`; both mean "the
 * summary was generated". We coerce those two shapes explicitly and treat
 * anything else (including a future `{ ok: true }` object or an unexpected
 * payload) as failure rather than silently passing a truthy object through as
 * `true`. If the SDK gains a richer success shape later, extend this helper
 * rather than widening the call site.
 */
function coerceSummarizeOk(raw: unknown): boolean {
  return raw === true || raw === "true";
}

function readQuestionPrompt(payload: Record<string, unknown>): string | null {
  const directPrompt = readString(payload.header) ?? readString(payload.text) ?? readString(payload.prompt);
  if (directPrompt) {
    return directPrompt;
  }
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  for (const entry of questions) {
    const parsed = readObject(entry);
    const prompt = parsed ? readString(parsed.header) ?? readString(parsed.text) : null;
    if (prompt) {
      return prompt;
    }
  }
  return null;
}

function unwrapList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) {
    return raw;
  }
  const parsed = readObject(unwrapDataPayload(raw));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

function mapModelEntry(raw: unknown): OpencodeModelEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readString(parsed.name) ?? id,
    providerId: readString(parsed.providerId) ?? readString(parsed.provider) ?? undefined,
  };
}

function mapProviderEntry(raw: unknown): OpencodeProviderEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readString(parsed.name) ?? id,
  };
}

function mapAgentEntry(raw: unknown): OpencodeAgentEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  if (!id) {
    return null;
  }
  return {
    id,
    name: readString(parsed.name) ?? readString(parsed.label) ?? id,
  };
}

/**
 * Maps a slash command from either OpenCode shape:
 *   - v1 `Command`  : `{ name, template, description?, agent?, subtask? }`
 *   - v2 `CommandV2Info` : same surface (template is always present)
 * Drops entries without a non-empty `name` / `template` (nothing to insert).
 */
function mapCommandEntry(raw: unknown): OpencodeCommandEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const name = readString(parsed.name);
  const template = readString(parsed.template);
  if (!name || !template) {
    return null;
  }
  return {
    name,
    template,
    ...(parsed.description !== undefined
      ? { description: readString(parsed.description) ?? undefined }
      : {}),
    ...(parsed.agent !== undefined ? { agent: readString(parsed.agent) ?? undefined } : {}),
    ...(parsed.subtask !== undefined ? { subtask: Boolean(parsed.subtask) } : {}),
  };
}

/** Maps a `FileSystemEntry` from `fs.find`. */
function mapFileSearchEntry(raw: unknown): OpencodeFileSearchEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const path = readString(parsed.path);
  if (!path) {
    return null;
  }
  const rawType = parsed.type;
  const type: "file" | "directory" =
    rawType === "file" || rawType === "directory" ? rawType : "file";
  return {
    path,
    type,
    mime: readString(parsed.mime) ?? (type === "directory" ? "inode/directory" : "application/octet-stream"),
  };
}

// --- M4 config-management mappers -------------------------------------------

/**
 * Maps the `provider.list` payload (`{ all: Provider[], connected: string[], default }`)
 * into SpecOps' `OpencodeProviderStatus[]`. Each provider carries a best-effort
 * model count (length of its `models` map).
 */
function mapProviderStatus(raw: unknown): OpencodeProviderStatus[] {
  const parsed = readObject(unwrapDataPayload(raw)) ?? unwrapDataPayload(raw);
  const obj = readObject(parsed);
  if (!obj) {
    return [];
  }
  const all = Array.isArray(obj.all) ? obj.all : [];
  const connectedList = Array.isArray(obj.connected) ? obj.connected : [];
  const connectedSet = new Set(
    connectedList.filter((entry): entry is string => typeof entry === "string"),
  );
  return all
    .map((entry): OpencodeProviderStatus | null => {
      const provider = readObject(entry);
      if (!provider) {
        return null;
      }
      const id = readString(provider.id);
      if (!id) {
        return null;
      }
      const modelsMap = readObject(provider.models);
      const modelCount = modelsMap ? Object.keys(modelsMap).length : 0;
      const source = readString(provider.source) ?? undefined;
      return {
        id,
        name: readString(provider.name) ?? id,
        connected: connectedSet.has(id),
        modelCount,
        ...(source ? { source } : {}),
      };
    })
    .filter((entry): entry is OpencodeProviderStatus => entry !== null);
}

/** Maps an MCP status map (`{ [name]: McpStatus }`) into display entries. */
function mapMcpStatuses(raw: unknown): OpencodeMcpStatusEntry[] {
  const parsed = readObject(unwrapDataPayload(raw));
  if (!parsed) {
    return [];
  }
  return Object.entries(parsed)
    .map(([name, value]): OpencodeMcpStatusEntry | null => {
      const statusObj = readObject(value);
      if (!statusObj) {
        return null;
      }
      const rawStatus = readString(statusObj.status);
      if (!rawStatus) {
        return null;
      }
      const status = (
        rawStatus === "connected" ||
        rawStatus === "disabled" ||
        rawStatus === "failed" ||
        rawStatus === "needs_auth" ||
        rawStatus === "needs_client_registration"
          ? rawStatus
          : "failed"
      ) as OpencodeMcpStatusEntry["status"];
      const error = readString(statusObj.error) ?? undefined;
      const enabled = status !== "disabled";
      const entry: OpencodeMcpStatusEntry = { name, status, enabled };
      if (error) {
        entry.error = error;
      }
      return entry;
    })
    .filter((entry): entry is OpencodeMcpStatusEntry => entry !== null);
}

/** Maps an `app.skills` entry (`{ name, description?, location, content }`). */
function mapSkillEntry(raw: unknown): OpencodeSkillEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const name = readString(parsed.name);
  const location = readString(parsed.location);
  if (!name || !location) {
    return null;
  }
  return {
    name,
    location,
    ...(parsed.description !== undefined
      ? { description: readString(parsed.description) ?? undefined }
      : {}),
  };
}

/** Maps an `app.agents` entry (richer `Agent` shape) for the management panel. */
function mapAgentDetail(raw: unknown): OpencodeAgentDetail | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const name = readString(parsed.name);
  if (!name) {
    return null;
  }
  const rawMode = readString(parsed.mode);
  const mode: OpencodeAgentDetail["mode"] =
    rawMode === "subagent" || rawMode === "primary" || rawMode === "all"
      ? rawMode
      : "all";
  const permissionRules = Array.isArray(parsed.permission) ? parsed.permission : [];
  const modelObj = readObject(parsed.model);
  const model = modelObj
    ? {
        modelId: readString(modelObj.modelID) ?? readString(modelObj.modelId) ?? "",
        providerId: readString(modelObj.providerID) ?? readString(modelObj.providerId) ?? "",
      }
    : undefined;
  const detail: OpencodeAgentDetail = {
    name,
    mode,
    builtin: parsed.native === true,
    permissionRuleCount: permissionRules.length,
  };
  if (parsed.description !== undefined) {
    detail.description = readString(parsed.description) ?? undefined;
  }
  if (parsed.hidden !== undefined) {
    detail.hidden = Boolean(parsed.hidden);
  }
  if (parsed.color !== undefined) {
    detail.color = readString(parsed.color) ?? undefined;
  }
  if (model) {
    detail.model = model;
  }
  if (parsed.variant !== undefined) {
    detail.variant = readString(parsed.variant) ?? undefined;
  }
  if (parsed.prompt !== undefined) {
    detail.prompt = readString(parsed.prompt) ?? undefined;
  }
  if (parsed.steps !== undefined) {
    const steps = readNumber(parsed.steps);
    if (steps !== null) {
      detail.steps = steps;
    }
  }
  return detail;
}

// --- M5 workspace-UX mappers ------------------------------------------------

const TODO_STATUS_VALUES: readonly OpencodeTodoStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];

const TODO_PRIORITY_VALUES: readonly OpencodeTodoPriority[] = ["high", "medium", "low"];

const FILE_STATUS_VALUES: readonly OpencodeFileChangeStatus[] = [
  "added",
  "deleted",
  "modified",
];

/**
 * Maps a single `Todo` from `session.todo`. `content` is required; unknown
 * status / priority strings fall back to `pending` / `medium` so a malformed
 * entry still renders (rather than being dropped silently).
 */
function mapTodoEntry(raw: unknown): OpencodeTodoEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const content = readString(parsed.content);
  if (!content) {
    return null;
  }
  const rawStatus = typeof parsed.status === "string" ? parsed.status : "";
  const status: OpencodeTodoStatus = (
    TODO_STATUS_VALUES as readonly string[]
  ).includes(rawStatus)
    ? (rawStatus as OpencodeTodoStatus)
    : "pending";
  const rawPriority = typeof parsed.priority === "string" ? parsed.priority : "";
  const priority: OpencodeTodoPriority = (
    TODO_PRIORITY_VALUES as readonly string[]
  ).includes(rawPriority)
    ? (rawPriority as OpencodeTodoPriority)
    : "medium";
  return { content, status, priority };
}

/**
 * Maps a single `SnapshotFileDiff` from `session.diff`. `file` falls back to
 * an empty string (some payloads omit it); `status` defaults to `modified`
 * when not present; additions / deletions default to 0.
 */
function mapSessionFileDiff(raw: unknown): OpencodeSessionFileDiff | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const rawStatus = typeof parsed.status === "string" ? parsed.status : "";
  const status: OpencodeFileChangeStatus = (
    FILE_STATUS_VALUES as readonly string[]
  ).includes(rawStatus)
    ? (rawStatus as OpencodeFileChangeStatus)
    : "modified";
  return {
    file: readString(parsed.file) ?? "",
    patch: readString(parsed.patch) ?? "",
    additions: readNumber(parsed.additions) ?? 0,
    deletions: readNumber(parsed.deletions) ?? 0,
    status,
  };
}

/** Maps a single `File` entry from `file.status` (git working tree). */
function mapFileStatusEntry(raw: unknown): OpencodeFileStatusEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const path = readString(parsed.path);
  if (!path) {
    return null;
  }
  const rawStatus = typeof parsed.status === "string" ? parsed.status : "";
  const status: OpencodeFileChangeStatus = (
    FILE_STATUS_VALUES as readonly string[]
  ).includes(rawStatus)
    ? (rawStatus as OpencodeFileChangeStatus)
    : "modified";
  return {
    path,
    additions: readNumber(parsed.additions) ?? readNumber(parsed.added) ?? 0,
    deletions: readNumber(parsed.deletions) ?? readNumber(parsed.removed) ?? 0,
    status,
  };
}

/** Maps a single `LspStatus` entry from `lsp` (`/lsp`). */
function mapLspStatusEntry(raw: unknown): OpencodeLspStatusEntry | null {
  const parsed = readObject(raw);
  if (!parsed) {
    return null;
  }
  const id = readString(parsed.id);
  const name = readString(parsed.name);
  if (!id || !name) {
    return null;
  }
  const root = readString(parsed.root) ?? "";
  const rawStatus = typeof parsed.status === "string" ? parsed.status : "";
  const status = rawStatus === "connected" || rawStatus === "error" ? rawStatus : "error";
  return { id, name, root, status };
}

/**
 * Reads the OAuth authorization URL from a `provider.oauth.authorize` payload.
 * OpenCode may return either a bare URL string or an object carrying `url`.
 * Returns null when no usable URL is present.
 */
function readOAuthUrl(raw: unknown): string | null {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw;
  }
  // Tolerate a `{ data: "url" }` or `{ data: { url } }` wrapper.
  const unwrapped = unwrapDataPayload(raw);
  if (typeof unwrapped === "string" && unwrapped.trim().length > 0) {
    return unwrapped;
  }
  const candidate = readObject(unwrapped) ?? readObject(raw);
  if (!candidate) {
    return null;
  }
  return (
    readString(candidate.url) ??
    readString(candidate.authorization_url) ??
    readString(candidate.authUrl)
  );
}

/** Reads the config document from a `config.get` / `config.update` payload. */
function mapConfigDocument(raw: unknown): OpencodeConfigDocument {
  const unwrapped = unwrapDataPayload(raw);
  const parsed = readObject(unwrapped);
  if (!parsed) {
    return {};
  }
  return parsed;
}

function readQuestionChoices(payload: Record<string, unknown>): string[] {
  const directChoices = Array.isArray(payload.choices) ? payload.choices : [];
  if (directChoices.length > 0) {
    return directChoices
      .map((entry) => {
        if (typeof entry === "string") {
          return readString(entry);
        }
        const parsed = readObject(entry);
        return parsed ? readString(parsed.label) ?? readString(parsed.text) ?? readString(parsed.value) : null;
      })
      .filter((entry): entry is string => Boolean(entry));
  }

  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const flattened: string[] = [];
  for (const entry of questions) {
    const question = readObject(entry);
    if (!question) {
      continue;
    }
    const options = Array.isArray(question.options) ? question.options : [];
    for (const option of options) {
      if (typeof option === "string") {
        const label = readString(option);
        if (label) {
          flattened.push(label);
        }
        continue;
      }
      const parsedOption = readObject(option);
      const label = parsedOption
        ? readString(parsedOption.label) ?? readString(parsedOption.text) ?? readString(parsedOption.value)
        : null;
      if (label) {
        flattened.push(label);
      }
    }
  }
  return flattened;
}

function extractSdkErrorDetail(error: unknown): string {
  const cause = readObject((error as Error | undefined)?.cause);
  const body = cause ? cause.body : undefined;
  if (typeof body === "string" && body.trim().length > 0) {
    return body;
  }
  const bodyObject = readObject(body);
  if (bodyObject) {
    const messageField = readString(bodyObject.message);
    if (messageField) {
      return messageField;
    }
    const dataObject = readObject(bodyObject.data);
    const dataMessage = dataObject ? readString(dataObject.message) : null;
    if (dataMessage) {
      return dataMessage;
    }
  }
  const messageField = readString((error as Error | undefined)?.message);
  return messageField ?? "";
}

function mapSdkError(error: unknown): WorkspaceAgentBackendError {
  if (error instanceof WorkspaceAgentBackendError) {
    return error;
  }
  const cause = readObject((error as Error | undefined)?.cause);
  const status = cause && typeof cause.status === "number" ? cause.status : null;
  const detail = extractSdkErrorDetail(error);
  if (status === null) {
    return new WorkspaceAgentBackendError({
      code: "serverUnavailable",
      message: detail || "OpenCode server is unavailable.",
      cause: error,
    });
  }
  return mapHttpError(status, detail);
}

function createSdkOpencodeClient(input: {
  baseUrl: string;
  workspaceRootPath: string;
  serverPassword: string;
}): RawOpencodeClient {
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const password = input.serverPassword?.trim() ?? "";
  const headers: Record<string, string> = {};
  if (password.length > 0) {
    headers.Authorization = `Basic ${btoa(`opencode:${password}`)}`;
  }

  const sdk: OpencodeSdkClient = createOpencodeSdkClient({
    baseUrl,
    directory: input.workspaceRootPath,
    headers,
    throwOnError: true,
  });

  async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try {
      const result = await fn();
      return result.data;
    } catch (error: unknown) {
      throw mapSdkError(error);
    }
  }

  function buildModelInput(payload: {
    model?: string;
    provider?: string;
  }): { providerID: string; modelID: string } | undefined {
    const modelId = readString(payload.model);
    const providerId = readString(payload.provider);
    if (!modelId || !providerId) {
      return undefined;
    }
    return { providerID: providerId, modelID: modelId };
  }

  /**
   * Builds the `parts` array for `session.prompt` from the bare prompt text
   * plus the composer-assembled context (M3). The text prompt always comes
   * first as a `text` part; file mentions are appended as a `text` part
   * enumerating the paths (so the model knows which files to read); agent
   * mentions become `agent` parts; attachments become `file` parts.
   */
  function buildPromptParts(payload: {
    prompt: string;
    context?: WorkspaceAgentSendContext;
  }): Array<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [{ type: "text", text: payload.prompt }];
    const ctx = payload.context;
    if (!ctx) {
      return parts;
    }
    const filePaths = (ctx.filePaths ?? []).filter((path) => path.trim().length > 0);
    if (filePaths.length > 0) {
      parts.push({
        type: "text",
        text: `Files:\n${filePaths.map((path) => `- @${path}`).join("\n")}`,
      });
    }
    for (const agentName of (ctx.agentNames ?? [])) {
      const trimmed = agentName.trim();
      if (trimmed.length === 0) {
        continue;
      }
      parts.push({ type: "agent", name: trimmed });
    }
    for (const attachment of (ctx.attachments ?? [])) {
      const url = attachment.url.trim();
      const mime = attachment.mime.trim();
      if (url.length === 0 || mime.length === 0) {
        continue;
      }
      parts.push({
        type: "file",
        mime,
        ...(attachment.filename && attachment.filename.trim().length > 0
          ? { filename: attachment.filename.trim() }
          : {}),
        url,
      });
    }
    return parts;
  }

  return {
    async createSession(payload) {
      return call(() => sdk.session.create({ title: payload.title }));
    },
    async getSession(payload) {
      return call(() => sdk.session.get({ sessionID: payload.sessionId }));
    },
    async listSessions(payload) {
      return call(() =>
        sdk.session.list({
          ...(payload?.search ? { search: payload.search } : {}),
          ...(payload?.limit ? { limit: payload.limit } : {}),
        }),
      );
    },
    async deleteSession(payload) {
      return call(() => sdk.session.delete({ sessionID: payload.sessionId }));
    },
    async sendPrompt(payload) {
      const model = buildModelInput(payload);
      const parts = buildPromptParts({ prompt: payload.prompt, context: payload.context });
      return call(() =>
        sdk.session.prompt({
          sessionID: payload.sessionId,
          // SDK expects a discriminated union of part shapes; we build them
          // dynamically from the composer context so cast to satisfy TS.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parts: parts as any,
          agent: payload.agent,
          model,
        }),
      );
    },
    async replyPermission(payload) {
      return call(() =>
        sdk.permission.reply({
          requestID: payload.requestId,
          reply: payload.reply,
          message: payload.message,
        }),
      );
    },
    async replyQuestion(payload) {
      return call(() =>
        sdk.question.reply({
          requestID: payload.requestId,
          answers: payload.answers,
        }),
      );
    },
    async rejectQuestion(payload) {
      return call(() =>
        sdk.question.reject({
          requestID: payload.requestId,
        }),
      );
    },
    async abortSession(payload) {
      return call(() => sdk.session.abort({ sessionID: payload.sessionId }));
    },
    async *streamEvents(payload) {
      const subscription = await sdk.event.subscribe().catch((error: unknown) => {
        throw mapSdkError(error);
      });
      for await (const event of subscription.stream) {
        yield event;
      }
    },
    async listMessages(payload): Promise<OpencodeSessionMessageEntry[]> {
      const data = await call(() => sdk.session.messages({ sessionID: payload.sessionId }));
      if (!Array.isArray(data)) {
        return [];
      }
      return data as OpencodeSessionMessageEntry[];
    },
    async updateSession(payload) {
      return call(() =>
        sdk.session.update({
          sessionID: payload.sessionId,
          ...(payload.title !== undefined ? { title: payload.title } : {}),
        }),
      );
    },
    async forkSession(payload) {
      return call(() =>
        sdk.session.fork({
          sessionID: payload.sessionId,
          ...(payload.messageId ? { messageID: payload.messageId } : {}),
        }),
      );
    },
    async revertSession(payload) {
      return call(() =>
        sdk.session.revert({
          sessionID: payload.sessionId,
          ...(payload.messageId ? { messageID: payload.messageId } : {}),
        }),
      );
    },
    async unrevertSession(payload) {
      return call(() => sdk.session.unrevert({ sessionID: payload.sessionId }));
    },
    async shareSession(payload) {
      return call(() => sdk.session.share({ sessionID: payload.sessionId }));
    },
    async unshareSession(payload) {
      return call(() => sdk.session.unshare({ sessionID: payload.sessionId }));
    },
    async summarizeSession(payload) {
      return call(() =>
        sdk.session.summarize({
          sessionID: payload.sessionId,
          ...(payload.providerId && payload.modelId
            ? { providerID: payload.providerId, modelID: payload.modelId }
            : {}),
        }),
      );
    },
    async listSessionChildren(payload) {
      return call(() => sdk.session.children({ sessionID: payload.sessionId }));
    },
    async listModels() {
      return call(() => sdk.config.providers());
    },
    async listProviders() {
      return call(() => sdk.provider.list());
    },
    async listAgents() {
      return call(() => sdk.app.agents());
    },
    async listCommands() {
      // Prefer the v2 namespace (`/api/command`); fall back to v1 (`/command`).
      try {
        return await call(() => sdk.v2.command.list());
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "notFound" || error.status === 404)
        ) {
          return call(() => sdk.command.list());
        }
        throw error;
      }
    },
    async findFiles(payload) {
      const data = await call(() =>
        sdk.v2.fs.find({
          query: payload.query,
          type: "file",
          ...(payload.limit ? { limit: String(payload.limit) } : {}),
        }),
      );
      const parsed = readObject(data);
      if (!parsed) {
        return [];
      }
      // v2 wraps the entries in `{ location, data: [...] }`; the bare array is
      // also tolerated.
      const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : [];
      return entries
        .map(mapFileSearchEntry)
        .filter((entry): entry is OpencodeFileSearchEntry => entry !== null);
    },
    // --- M4 config management -------------------------------------------------
    async getConfig() {
      return call(() => sdk.config.get());
    },
    async updateConfig(config) {
      return call(() => sdk.config.update({ config }));
    },
    async listProviderStatuses() {
      return call(() => sdk.provider.list());
    },
    async listProviderAuthMethods() {
      return call(() => sdk.provider.auth());
    },
    async setProviderAuth(providerId, apiKey) {
      return call(() =>
        sdk.auth.set({ providerID: providerId, auth: { type: "api", key: apiKey } }),
      );
    },
    async removeProviderAuth(providerId) {
      return call(() => sdk.auth.remove({ providerID: providerId }));
    },
    async startProviderOAuth(providerId) {
      const data = await call(() => sdk.provider.oauth.authorize({ providerID: providerId }));
      // `authorize` returns an auth URL (or an object carrying `url`); surface
      // the URL string so the UI can open it, or null when already authed.
      return readOAuthUrl(data);
    },
    async completeProviderOAuth(providerId, code) {
      await call(() =>
        sdk.provider.oauth.callback({ providerID: providerId, ...(code ? { code } : {}) }),
      );
      return true;
    },
    async listMcpStatuses() {
      return call(() => sdk.mcp.status());
    },
    async addMcpServer(name, config) {
      return call(() => sdk.mcp.add({ name, config }));
    },
    async connectMcpServer(name) {
      await call(() => sdk.mcp.connect({ name }));
      return true;
    },
    async disconnectMcpServer(name) {
      await call(() => sdk.mcp.disconnect({ name }));
      return true;
    },
    async listSkills() {
      return call(() => sdk.app.skills());
    },
    async listAgentDetails() {
      return call(() => sdk.app.agents());
    },
    // --- M5 — workspace UX ----------------------------------------------------
    async listSessionTodos(payload) {
      return call(() => sdk.session.todo({ sessionID: payload.sessionId }));
    },
    async listSessionDiffs(payload) {
      return call(() =>
        sdk.session.diff({
          sessionID: payload.sessionId,
          ...(payload.messageId ? { messageID: payload.messageId } : {}),
        }),
      );
    },
    async listFileStatuses() {
      return call(() => sdk.file.status());
    },
    async listLspStatuses() {
      return call(() => sdk.lsp.status());
    },
  };
}

function createCursorLocalBackend(): WorkspaceAgentBackend {
  const id: WorkspaceAgentBackendId = "cursor-local";
  const fail = (): never => {
    throw new WorkspaceAgentBackendNotImplementedError(id);
  };
  return {
    id,
    async createSession() {
      return fail();
    },
    async getSession() {
      return fail();
    },
    async getSessionDetails() {
      return fail();
    },
    async listSessions() {
      return fail();
    },
    async listSessionDetails() {
      return fail();
    },
    async deleteSession() {
      return fail();
    },
    async send() {
      return fail();
    },
    async replyPermission() {
      return fail();
    },
    async replyQuestion() {
      return fail();
    },
    async rejectQuestion() {
      return fail();
    },
    async abortSession() {
      return fail();
    },
    async *streamEvents() {
      return fail();
    },
    async listMessages() {
      return fail();
    },
    async updateSessionTitle() {
      return fail();
    },
    async forkSession() {
      return fail();
    },
    async revertSession() {
      return fail();
    },
    async unrevertSession() {
      return fail();
    },
    async shareSession() {
      return fail();
    },
    async unshareSession() {
      return fail();
    },
    async summarizeSession() {
      return fail();
    },
    async listSessionChildren() {
      return fail();
    },
    async listModels() {
      return fail();
    },
    async listProviders() {
      return fail();
    },
    async listAgents() {
      return fail();
    },
    async listCommands() {
      return fail();
    },
    async findFiles() {
      return fail();
    },
    // M4 — config management (cursor-local not implemented yet)
    async getConfig() {
      return fail();
    },
    async updateConfig() {
      return fail();
    },
    async listProviderStatuses() {
      return fail();
    },
    async setProviderApiKey() {
      return fail();
    },
    async removeProviderAuth() {
      return fail();
    },
    async startProviderOAuth() {
      return fail();
    },
    async completeProviderOAuth() {
      return fail();
    },
    async listMcpStatuses() {
      return fail();
    },
    async addMcpServer() {
      return fail();
    },
    async connectMcpServer() {
      return fail();
    },
    async disconnectMcpServer() {
      return fail();
    },
    async listSkills() {
      return fail();
    },
    async listAgentDetails() {
      return fail();
    },
    // M5 — workspace UX (cursor-local not implemented yet)
    async listSessionTodos() {
      return fail();
    },
    async listSessionDiffs() {
      return fail();
    },
    async listFileStatuses() {
      return fail();
    },
    async listLspStatuses() {
      return fail();
    },
  };
}

function createOpencodeBackend(
  deps: WorkspaceAgentBackendDependencies = {},
): WorkspaceAgentBackend {
  const resolveRuntimeConfig =
    deps.resolveRuntimeConfig ??
    (async (): Promise<OpencodeRuntimeConfig> => ({
      mode: "sidecar",
      baseUrl: DEFAULT_OPENCODE_BASE_URL,
    }));
  const resolveServerPassword =
    deps.resolveServerPassword ??
    (async (): Promise<string> => {
      try {
        return await loadOpencodeServerPassword();
      } catch {
        return "";
      }
    });
  const createOpencodeClient = deps.createOpencodeClient ?? createSdkOpencodeClient;

  async function createClientForWorkspace(workspaceRootPath: string): Promise<RawOpencodeClient> {
    const directory = assertWorkspaceRootPath(workspaceRootPath);
    const [runtime, serverPassword] = await Promise.all([
      resolveRuntimeConfig(),
      resolveServerPassword(),
    ]);
    let baseUrl = runtime.baseUrl.trim();
    if (runtime.mode === "sidecar") {
      // M13.5 — central sidecar service. `background-sync` / `status-only`
      // intents never spawn; `send` / `settings` may spawn when needed.
      const ensured = await ensureOpencodeSidecar({
        intent: deps.ensureIntent ?? "settings",
        directory,
      }).catch((error: unknown) => {
        throw new WorkspaceAgentBackendError({
          code: "serverUnavailable",
          message: "Failed to start or attach OpenCode sidecar.",
          cause: error,
        });
      });
      if (!ensured) {
        throw new WorkspaceAgentBackendError({
          code: "serverUnavailable",
          message: "OpenCode sidecar is not running.",
        });
      }
      baseUrl = ensured.status.baseUrl ?? baseUrl;
    }
    if (baseUrl.length === 0) {
      throw new WorkspaceAgentBackendError({
        code: "serverUnavailable",
        message: "OpenCode base URL is missing.",
      });
    }
    return createOpencodeClient({ baseUrl, workspaceRootPath: directory, serverPassword });
  }

  /**
   * M10-T4 — shared fetch→unwrap→map→filter-null skeleton for the M5
   * workspace-UX list endpoints. Degrades to `[]` on the transient error codes
   * (`serverUnavailable` / `transportError` / `authFailure` / `notFound`) so a
   * flaky server never blocks the panels; any other error rethrows.
   */
  async function listAndMap<T>(
    fetch: () => Promise<unknown>,
    mapper: (raw: unknown) => T | null,
  ): Promise<T[]> {
    try {
      const entries = unwrapList(await fetch());
      if (!entries) {
        return [];
      }
      return entries.map(mapper).filter((entry): entry is T => entry !== null);
    } catch (error: unknown) {
      if (
        error instanceof WorkspaceAgentBackendError &&
        (error.code === "serverUnavailable" ||
          error.code === "transportError" ||
          error.code === "authFailure" ||
          error.code === "notFound")
      ) {
        return [];
      }
      throw error;
    }
  }

  return {
    id: "opencode",
    async createSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.createSession({ title: input.title });
      return mapSession(raw);
    },
    async getSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.getSession({ sessionId: input.sessionId });
        return mapSession(raw);
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return null;
        }
        throw error;
      }
    },
    async getSessionDetails(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.getSession({ sessionId: input.sessionId });
        return mapSessionDetails(raw);
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return null;
        }
        throw error;
      }
    },
    async listSessions(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listSessions();
      const entries = unwrapSessionList(raw);
      if (!entries) {
        throw new WorkspaceAgentBackendError({
          code: "invalidResponse",
          message: "OpenCode sessions response must be an array.",
          cause: raw,
        });
      }
      return entries.map((entry) => mapSession(entry));
    },
    async listSessionDetails(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listSessions({
        ...(input.search ? { search: input.search } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      });
      const entries = unwrapSessionList(raw);
      if (!entries) {
        return [];
      }
      return entries.map((entry) => mapSessionDetails(entry));
    },
    async deleteSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        await client.deleteSession({ sessionId: input.sessionId });
        return true;
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return false;
        }
        throw error;
      }
    },
    async send(request) {
      const client = await createClientForWorkspace(request.workspaceRootPath);
      const raw = await client.sendPrompt({
        sessionId: request.sessionId,
        prompt: request.prompt,
        model: request.model,
        agent: request.agent,
        provider: request.provider,
        ...(request.context ? { context: request.context } : {}),
      });
      return mapRunResult(raw, request.sessionId);
    },
    async replyPermission(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.replyPermission({
        sessionId: input.sessionId,
        requestId: input.requestId,
        reply: input.reply,
        message: input.message,
      });
    },
    async replyQuestion(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.replyQuestion({
        sessionId: input.sessionId,
        requestId: input.requestId,
        answers: input.answers,
      });
    },
    async rejectQuestion(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.rejectQuestion({
        sessionId: input.sessionId,
        requestId: input.requestId,
        message: input.message,
      });
    },
    async abortSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      await client.abortSession({
        sessionId: input.sessionId,
      });
    },
    async *streamEvents(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const state: StreamNormalizationState = {
        seenEventKeys: new Set<string>(),
        startedToolCallKeys: new Set<string>(),
      };
      for await (const event of client.streamEvents({
        sessionId: input.sessionId,
      })) {
        const normalized = mapStreamFrame(event, state);
        for (const normalizedEvent of normalized) {
          yield normalizedEvent;
        }
      }
    },
    async listMessages(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.listMessages({ sessionId: input.sessionId });
        const entries = unwrapList(raw);
        if (!entries) {
          return [];
        }
        return entries.map((entry) => {
          const parsed = readObject(entry) ?? {};
          return {
            info: parsed.info ?? null,
            parts: Array.isArray(parsed.parts) ? parsed.parts : [],
          };
        });
      } catch (error: unknown) {
        if (error instanceof WorkspaceAgentBackendError && error.code === "notFound") {
          return [];
        }
        throw error;
      }
    },
    async updateSessionTitle(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.updateSession({
        sessionId: input.sessionId,
        title: input.title,
      });
      return mapSessionDetails(raw);
    },
    async forkSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.forkSession({
        sessionId: input.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
      });
      return mapSessionDetails(raw);
    },
    async revertSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.revertSession({
        sessionId: input.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
      });
      return mapSessionDetails(raw);
    },
    async unrevertSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.unrevertSession({ sessionId: input.sessionId });
      return mapSessionDetails(raw);
    },
    async shareSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.shareSession({ sessionId: input.sessionId });
      return mapSessionDetails(raw);
    },
    async unshareSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.unshareSession({ sessionId: input.sessionId });
      return mapSessionDetails(raw);
    },
    async summarizeSession(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.summarizeSession({
        sessionId: input.sessionId,
        ...(input.modelId && input.providerId
          ? { modelId: input.modelId, providerId: input.providerId }
          : {}),
      });
      return coerceSummarizeOk(raw);
    },
    async listSessionChildren(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listSessionChildren({ sessionId: input.sessionId });
      const entries = unwrapSessionList(raw);
      if (!entries) {
        return [];
      }
      return entries.map((entry) => mapSessionDetails(entry));
    },
    async listModels(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listModels();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries.map(mapModelEntry).filter((entry): entry is OpencodeModelEntry => entry !== null);
    },
    async listProviders(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listProviders();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries.map(mapProviderEntry).filter((entry): entry is OpencodeProviderEntry => entry !== null);
    },
    async listAgents(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listAgents();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries.map(mapAgentEntry).filter((entry): entry is OpencodeAgentEntry => entry !== null);
    },
    async listCommands(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.listCommands();
        const entries = unwrapList(raw);
        if (!entries) {
          return [];
        }
        return entries
          .map(mapCommandEntry)
          .filter((entry): entry is OpencodeCommandEntry => entry !== null);
      } catch (error: unknown) {
        // Commands are optional for the composer; degrade to empty list on
        // transport / auth errors rather than blocking the workspace.
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "serverUnavailable" ||
            error.code === "transportError" ||
            error.code === "authFailure" ||
            error.code === "notFound")
        ) {
          return [];
        }
        throw error;
      }
    },
    async findFiles(input) {
      const trimmed = input.query.trim();
      if (trimmed.length === 0) {
        return [];
      }
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.findFiles({
          query: trimmed,
          ...(input.limit ? { limit: input.limit } : {}),
        });
        // The SDK impl already returns OpencodeFileSearchEntry[], but the
        // RawOpencodeClient interface is typed as `unknown` — normalize so
        // the public contract holds regardless of client impl.
        if (Array.isArray(raw)) {
          return raw as OpencodeFileSearchEntry[];
        }
        return [];
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "serverUnavailable" ||
            error.code === "transportError" ||
            error.code === "authFailure" ||
            error.code === "notFound")
        ) {
          return [];
        }
        throw error;
      }
    },
    // --- M4 — config management ---------------------------------------------
    async getConfig(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.getConfig();
      return mapConfigDocument(raw);
    },
    async updateConfig(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.updateConfig(input.config);
      return mapConfigDocument(raw);
    },
    async listProviderStatuses(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listProviderStatuses();
      return mapProviderStatus(raw);
    },
    async setProviderApiKey(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        await client.setProviderAuth(input.providerId, input.apiKey);
        return true;
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "authFailure" || error.code === "notFound")
        ) {
          return false;
        }
        throw error;
      }
    },
    async removeProviderAuth(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        await client.removeProviderAuth(input.providerId);
        return true;
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "authFailure" || error.code === "notFound")
        ) {
          return false;
        }
        throw error;
      }
    },
    async startProviderOAuth(input): Promise<string | null> {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.startProviderOAuth(input.providerId);
        return readOAuthUrl(raw);
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "notFound" || error.code === "authFailure")
        ) {
          return null;
        }
        throw error;
      }
    },
    async completeProviderOAuth(input): Promise<boolean> {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        return Boolean(await client.completeProviderOAuth(input.providerId, input.code));
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "notFound" || error.code === "authFailure")
        ) {
          return false;
        }
        throw error;
      }
    },
    async listMcpStatuses(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listMcpStatuses();
      return mapMcpStatuses(raw);
    },
    async addMcpServer(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.addMcpServer(input.name, input.config);
      return mapMcpStatuses(raw);
    },
    async connectMcpServer(input): Promise<boolean> {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        await client.connectMcpServer(input.name);
        return true;
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          error.code === "notFound"
        ) {
          return false;
        }
        throw error;
      }
    },
    async disconnectMcpServer(input): Promise<boolean> {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        await client.disconnectMcpServer(input.name);
        return true;
      } catch (error: unknown) {
        if (
          error instanceof WorkspaceAgentBackendError &&
          error.code === "notFound"
        ) {
          return false;
        }
        throw error;
      }
    },
    async listSkills(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      try {
        const raw = await client.listSkills();
        const entries = unwrapList(raw);
        if (!entries) {
          return [];
        }
        return entries
          .map(mapSkillEntry)
          .filter((entry): entry is OpencodeSkillEntry => entry !== null);
      } catch (error: unknown) {
        // Skills are optional; degrade to empty list rather than blocking the panel.
        if (
          error instanceof WorkspaceAgentBackendError &&
          (error.code === "serverUnavailable" ||
            error.code === "transportError" ||
            error.code === "authFailure" ||
            error.code === "notFound")
        ) {
          return [];
        }
        throw error;
      }
    },
    async listAgentDetails(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      const raw = await client.listAgentDetails();
      const entries = unwrapList(raw);
      if (!entries) {
        return [];
      }
      return entries
        .map(mapAgentDetail)
        .filter((entry): entry is OpencodeAgentDetail => entry !== null);
    },
    // --- M5 — workspace UX ----------------------------------------------------
    //
    // M10-T4: the four list-and-map methods share an identical skeleton — fetch
    // raw, unwrap a list, map + filter-null, and degrade to [] on the transient
    // error codes. `listAndMap` encapsulates it so the methods are one-liners.
    async listSessionTodos(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      return listAndMap(
        () => client.listSessionTodos({ sessionId: input.sessionId }),
        mapTodoEntry,
      );
    },
    async listSessionDiffs(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      return listAndMap(
        () =>
          client.listSessionDiffs({
            sessionId: input.sessionId,
            ...(input.messageId ? { messageId: input.messageId } : {}),
          }),
        mapSessionFileDiff,
      );
    },
    async listFileStatuses(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      return listAndMap(() => client.listFileStatuses(), mapFileStatusEntry);
    },
    async listLspStatuses(input) {
      const client = await createClientForWorkspace(input.workspaceRootPath);
      return listAndMap(() => client.listLspStatuses(), mapLspStatusEntry);
    },
  };
}

export function createWorkspaceAgentBackend(
  id: WorkspaceAgentBackendId,
  deps: WorkspaceAgentBackendDependencies = {},
): WorkspaceAgentBackend {
  if (id === "opencode") {
    return createOpencodeBackend(deps);
  }
  return createCursorLocalBackend();
}
