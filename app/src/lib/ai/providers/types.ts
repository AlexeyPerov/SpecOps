import type {
  ChatMessage,
  ChatModeId,
  ChatProviderId,
  ChatThreadSnapshot,
} from "../../domain/contracts";
import type { CapabilityCheckInput, CapabilityCheckResult, WorkspaceAccessStatus } from "../capabilities";
import { buildThreadPromptContext } from "../../services/chatRetention";

export interface WorkspaceMetadata {
  rootPath: string;
  name: string;
}

/** Conversation turns included in provider prompts; system UI events are excluded. */
export interface ProviderHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Mode-aware, provider-agnostic prompt payload assembled from thread context.
 * Consumed by Debug, HTTP, and future providers via the shared builder.
 */
export interface ProviderRequestPayload {
  mode: ChatModeId;
  provider: ChatProviderId;
  workspace: WorkspaceMetadata;
  summary?: string;
  history: ProviderHistoryMessage[];
  /** Resolved mode system prompt; supplied by mode templates in M5-2. */
  systemPrompt?: string;
}

export interface ProviderSendRequest {
  payload: ProviderRequestPayload;
  /** Resolved model id for this turn (from thread metadata + provider catalog default). */
  modelId: string;
  /** Selected HTTP connection for `provider === "http"` turns. */
  connectionId?: string;
  /** Stable turn identity for deterministic Debug simulation (M5-4). */
  turnKey?: string;
  /** Optional access status for Debug diagnostics appendix. */
  accessStatus?: WorkspaceAccessStatus;
  /** Optional cancellation signal for in-flight provider requests. */
  signal?: AbortSignal;
}

export interface ProviderSendResponse {
  content: string;
}

export interface ProviderStreamChunk {
  delta: string;
}

export interface ProviderRequestInput {
  mode: ChatModeId;
  provider: ChatProviderId;
  workspaceRootPath: string;
  summary?: string;
  recentMessages: ChatMessage[];
  systemPrompt?: string;
}

export interface ChatProvider {
  readonly id: ChatProviderId;
  checkCapabilities(input: CapabilityCheckInput): Promise<CapabilityCheckResult>;
  sendMessage(request: ProviderSendRequest): Promise<ProviderSendResponse>;
  streamMessage?(request: ProviderSendRequest): AsyncIterable<ProviderStreamChunk>;
}

function workspaceNameFromPath(rootPath: string): string {
  const trimmed = rootPath.replace(/\/+$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
}

function toProviderHistoryMessages(messages: readonly ChatMessage[]): ProviderHistoryMessage[] {
  return messages
    .filter((message): message is ChatMessage & { role: "user" | "assistant" } =>
      message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

/** Assembles the shared provider prompt payload from mode, workspace, summary, and history. */
export function buildProviderRequest(input: ProviderRequestInput): ProviderRequestPayload {
  const payload: ProviderRequestPayload = {
    mode: input.mode,
    provider: input.provider,
    workspace: {
      rootPath: input.workspaceRootPath,
      name: workspaceNameFromPath(input.workspaceRootPath),
    },
    history: toProviderHistoryMessages(input.recentMessages),
  };

  const summary = input.summary?.trim();
  if (summary) {
    payload.summary = summary;
  }

  const systemPrompt = input.systemPrompt?.trim();
  if (systemPrompt) {
    payload.systemPrompt = systemPrompt;
  }

  return payload;
}

/** Convenience wrapper that reads summary and recent messages from a thread snapshot. */
export function buildProviderRequestFromThread(
  thread: ChatThreadSnapshot,
  workspaceRootPath: string,
  systemPrompt?: string,
): ProviderRequestPayload {
  const { summary, recentMessages } = buildThreadPromptContext(thread);
  return buildProviderRequest({
    mode: thread.metadata.mode,
    provider: thread.metadata.provider,
    workspaceRootPath,
    summary,
    recentMessages,
    systemPrompt,
  });
}
