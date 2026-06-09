import type { ChatMessage, ChatThreadSnapshot } from "../domain/contracts";
import { buildThreadProviderRequest } from "./modes/prompt";
import type { ChatModePromptScopeKind } from "./modes/prompt";

const APPROX_CHARS_PER_TOKEN = 4;
const CONTEXT_LIMIT_PATTERNS: ReadonlyArray<{ pattern: RegExp; tokens: number }> = [
  { pattern: /\b1m\b/i, tokens: 1_000_000 },
  { pattern: /\b200k\b/i, tokens: 200_000 },
  { pattern: /\b128k\b/i, tokens: 128_000 },
  { pattern: /\b64k\b/i, tokens: 64_000 },
  { pattern: /\b32k\b/i, tokens: 32_000 },
  { pattern: /\b16k\b/i, tokens: 16_000 },
  { pattern: /\b8k\b/i, tokens: 8_000 },
];

export interface ContextWindowEstimateInput {
  thread: ChatThreadSnapshot;
  workspaceRootPath: string;
  settings: Parameters<typeof buildThreadProviderRequest>[2];
  scopeKind: ChatModePromptScopeKind;
  draft: string;
}

export interface ContextWindowEstimate {
  estimatedTokens: number;
  estimatedLimitTokens?: number;
}

function countEstimatedTokens(text: string): number {
  const compact = text.trim();
  if (!compact) {
    return 0;
  }
  return Math.ceil(compact.length / APPROX_CHARS_PER_TOKEN);
}

function tokenizeHistoryWithApproximation(messages: readonly { role: string; content: string }[]): number {
  let total = 0;
  for (const message of messages) {
    total += 4;
    total += countEstimatedTokens(message.content);
    if (message.role === "assistant") {
      total += 2;
    }
  }
  return total;
}

export function resolveEstimatedContextLimit(modelId: string): number | undefined {
  const normalized = modelId.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "debug-simulator") {
    return undefined;
  }
  for (const entry of CONTEXT_LIMIT_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return entry.tokens;
    }
  }
  if (/^gpt-4o(-mini)?$/i.test(normalized) || /^gpt-4o-/i.test(normalized)) {
    return 128_000;
  }
  return undefined;
}

function appendDraftMessage(messages: readonly ChatMessage[], draft: string): ChatMessage[] {
  const trimmedDraft = draft.trim();
  if (!trimmedDraft) {
    return [...messages];
  }
  return [
    ...messages,
    {
      id: "budget-preview-draft",
      role: "user",
      content: trimmedDraft,
      createdAt: "",
    },
  ];
}

export function estimateContextWindowBudget(input: ContextWindowEstimateInput): ContextWindowEstimate {
  const payload = buildThreadProviderRequest(
    {
      ...input.thread,
      messages: appendDraftMessage(input.thread.messages, input.draft),
    },
    input.workspaceRootPath,
    input.settings,
    input.scopeKind,
  );

  const systemPromptTokens = countEstimatedTokens(payload.systemPrompt ?? "");
  const historyTokens = tokenizeHistoryWithApproximation(payload.history);
  const estimatedTokens = Math.max(0, systemPromptTokens + historyTokens);
  return {
    estimatedTokens,
    estimatedLimitTokens: resolveEstimatedContextLimit(input.thread.metadata.selectedModelId ?? ""),
  };
}
