export type ChatMessageRole = "user" | "assistant" | "system";

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
  toolCalls?: ToolCallRecord[];
  /** Structured parts (reasoning, subtask, step, file, diff, etc.). */
  parts?: ChatMessagePart[];
}

export interface ChatThreadMetadata {
  sessionId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  /** Number of FIFO compaction events applied to this thread. */
  compactionCount?: number;
  /** ISO timestamp of the most recent compaction event. */
  lastCompactedAt?: string;
  /** Cumulative count of messages removed by compaction (for UI indicators). */
  compactedMessageCount?: number;
  /** Per-thread selected model; omitted until explicitly set. */
  selectedModelId?: string;
  /** Per-thread selected mode (autonomy level); omitted until explicitly set. */
  selectedModeId?: string;
  /** Runtime this thread's session is bound to (immutable after first link). */
  runtimeId?: string;
}

/** One persisted workspace session conversation (messages + per-session settings). */
export interface ChatThreadSnapshot {
  metadata: ChatThreadMetadata;
  messages: ChatMessage[];
}

export interface SessionIndexEntry {
  id: string;
  title: string;
  lastUsedAt: string;
  /** Session-only drafts are not written to disk until first user message. */
  isDraft?: boolean;
  /** Runtime this session is bound to; immutable once a native link exists. */
  runtimeId?: string;
  /** Native session id on the bound runtime for this workspace session tab. */
  nativeSessionId?: string;
  /** Last model used with the linked native session (restore hint). */
  modelId?: string;
  /** Public share URL when the linked session has been shared. */
  shareUrl?: string;
  /** Native session this one was forked from, if any. */
  parentSessionId?: string;
}

/** Per-workspace session list only — no conversation payload. */
export interface WorkspaceSessionsIndexSnapshot {
  version: 1;
  sessions: SessionIndexEntry[];
}

/** Versioned on-disk envelope for a single session thread file. */
export interface ChatSessionThreadFileSnapshot {
  version: 1;
  thread: ChatThreadSnapshot;
}
