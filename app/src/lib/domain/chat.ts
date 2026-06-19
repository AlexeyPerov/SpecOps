export type ChatMessageRole = "user" | "assistant" | "system";

export type BuiltinChatModeId = "ask" | "review" | "raw";

/** Built-in ids or user-defined custom mode ids (e.g. `custom-{uuid}`). */
export type ChatModeId = BuiltinChatModeId | (string & {});

export interface ChatModeContextToggles {
  includeWorkspace: boolean;
  includeSummary: boolean;
}

export type BuiltinChatModeToggles = Record<BuiltinChatModeId, ChatModeContextToggles>;

export interface CustomChatModeDefinition {
  id: string;
  name: string;
  prompt: string;
  enabled: boolean;
  includeWorkspace: boolean;
  includeSummary: boolean;
  requiredSections: string[];
  sectionGuidance?: string;
}

export interface ChatModesSettings {
  rawEnabled: boolean;
  builtinToggles: BuiltinChatModeToggles;
  customModes: CustomChatModeDefinition[];
}

export type ChatProviderId = "http" | "debug-chat" | "debug-workspace";

/** MVP product providers; debug variants are dev-only and settings-gated (see M5-3). */
export const PRODUCT_CHAT_PROVIDER_IDS = ["http"] as const satisfies readonly ChatProviderId[];

export const DEBUG_CHAT_PROVIDER_IDS = [
  "debug-chat",
  "debug-workspace",
] as const satisfies readonly ChatProviderId[];

export function isDebugChatProviderId(provider: ChatProviderId): provider is (typeof DEBUG_CHAT_PROVIDER_IDS)[number] {
  return provider === "debug-chat" || provider === "debug-workspace";
}

/**
 * System-only marker events persisted in chat history.
 * Provider and model switches are auditable in thread message history.
 */
export type ChatSystemEvent =
  | {
      type: "provider-switched";
      fromProvider: ChatProviderId | null;
      toProvider: ChatProviderId;
    }
  | {
      type: "model-switched";
      fromModel: string | null;
      toModel: string;
    };

export type ToolCallStatus = "pending" | "success" | "failure";

export interface ToolCallRecord {
  callId: string;
  toolName: string;
  status: ToolCallStatus;
  input?: unknown;
  output?: unknown;
  progress?: unknown;
}

/** Token usage breakdown for cost / step parts. */
export interface ChatTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** Structured message part — a single assistant message may carry many parts. */
export interface ChatTextPart {
  type: "text";
  id?: string;
  text: string;
}

export interface ChatReasoningPart {
  type: "reasoning";
  id?: string;
  text: string;
}

export type ChatSubtaskStatus = "running" | "completed" | "failed";

export interface ChatSubtaskPart {
  type: "subtask";
  id?: string;
  agent: string;
  description?: string;
  prompt?: string;
  status: ChatSubtaskStatus;
  output?: string;
  error?: string;
}

export interface ChatStepPart {
  type: "step";
  id?: string;
  phase: "start" | "finish";
  index?: number;
  reason?: string;
  cost?: number;
  tokens?: ChatTokenUsage;
}

export interface ChatFilePart {
  type: "file";
  id?: string;
  mime: string;
  filename?: string;
  url: string;
}

export interface ChatDiffPart {
  type: "diff";
  id?: string;
  snapshot?: string;
  files?: string[];
}

export interface ChatCostPart {
  type: "cost";
  id?: string;
  cost: number;
  tokens?: ChatTokenUsage;
}

export type ChatMessagePart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatSubtaskPart
  | ChatStepPart
  | ChatFilePart
  | ChatDiffPart
  | ChatCostPart;

/** Discriminator strings for `ChatMessagePart`. */
export type ChatMessagePartType = ChatMessagePart["type"];

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  systemEvent?: ChatSystemEvent;
  toolCalls?: ToolCallRecord[];
  /** Structured parts (reasoning, subtask, step, file, diff, etc.). */
  parts?: ChatMessagePart[];
}

export interface ChatThreadMetadata {
  agentId: string;
  threadId: string;
  mode: ChatModeId;
  /** Chat HTTP/debug provider; omitted for workspace (OpenCode) threads. */
  provider?: ChatProviderId;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  /** Number of FIFO compaction events applied to this thread. */
  compactionCount?: number;
  /** ISO timestamp of the most recent compaction event. */
  lastCompactedAt?: string;
  /** Cumulative count of messages removed by compaction (for UI indicators). */
  compactedMessageCount?: number;
  /** Per-thread selected model for the active provider; omitted until explicitly set. */
  selectedModelId?: string;
  /** Selected HTTP connection for `provider === "http"` threads. */
  connectionId?: string;
  /** Selected OpenCode agent for workspace threads (e.g. plan, build). */
  opencodeAgentId?: string;
  /** Selected OpenCode provider for workspace threads. */
  opencodeProviderId?: string;
}

/** One persisted agent conversation (messages + per-agent settings). */
export interface ChatThreadSnapshot {
  metadata: ChatThreadMetadata;
  messages: ChatMessage[];
}

export interface AgentIndexEntry {
  id: string;
  title: string;
  lastUsedAt: string;
  /** Session-only drafts are not written to disk until first user message. */
  isDraft?: boolean;
  /** Linked OpenCode session for this agent tab (phase 3 workspace runtime). */
  opencodeSessionId?: string;
  /** Last model used with the linked OpenCode session (restore hint). */
  opencodeModelId?: string;
  /** Last provider/runtime hint paired with the linked OpenCode session. */
  opencodeProviderId?: string;
  /** Public share URL when the linked session has been shared (M2-T5). */
  opencodeShareUrl?: string;
  /** OpenCode session this one was forked from, if any (M2-T3). */
  opencodeParentSessionId?: string;
}

/** Per-workspace agent list only — no conversation payload. */
export interface WorkspaceAgentsIndexSnapshot {
  version: 1;
  agents: AgentIndexEntry[];
}

/** Versioned on-disk envelope for a single agent thread file. */
export interface ChatAgentThreadFileSnapshot {
  version: 1;
  thread: ChatThreadSnapshot;
}
