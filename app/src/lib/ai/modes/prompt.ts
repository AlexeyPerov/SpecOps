import type { AppSettingsState, ChatThreadSnapshot } from "../../domain/contracts";
import { buildProviderRequest, type ProviderRequestPayload } from "../providers/types";
import { REVIEW_EFFORT_ESTIMATE_GUIDANCE } from "./builtins";
import { resolveChatMode, type ResolvedChatMode } from "./resolve";

export type ChatModePromptScopeKind = "workspace" | "chat-http";

export interface ResolveModeSystemTextContext {
  workspaceRootPath: string;
  workspaceName: string;
  summary?: string;
  scopeKind: ChatModePromptScopeKind;
}

function sectionInstructions(mode: ResolvedChatMode): string {
  if (mode.requiredSections.length === 0) {
    return "";
  }

  const lines = [
    "Structure every response with these sections (use the headings exactly):",
    ...mode.requiredSections.map((section) => `## ${section}`),
  ];
  if (mode.id === "review") {
    lines.push(`Include ${REVIEW_EFFORT_ESTIMATE_GUIDANCE}.`);
  } else if (mode.sectionGuidance?.trim()) {
    lines.push(mode.sectionGuidance.trim());
  }
  return lines.join("\n");
}

function normalizePromptText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

function workspacePromptLine(context: ResolveModeSystemTextContext): string {
  // Chat scope has no filesystem root; use a stable user-facing label.
  if (context.scopeKind === "chat-http") {
    return "Workspace: Chats (chat-http)";
  }
  return `Workspace: ${context.workspaceName} (${context.workspaceRootPath})`;
}

export function resolveModeSystemText(
  mode: ResolvedChatMode,
  context: ResolveModeSystemTextContext,
): string {
  const workspaceText = mode.includeWorkspace ? workspacePromptLine(context) : "";
  const summaryText =
    mode.includeSummary && context.summary?.trim()
      ? `Earlier conversation summary:\n${context.summary.trim()}`
      : "";

  const base = mode.promptTemplate
    .replaceAll("{{workspace}}", workspaceText)
    .replaceAll("{{summary}}", summaryText);
  const structured = sectionInstructions(mode);
  return normalizePromptText([base, structured].filter(Boolean).join("\n\n"));
}

/**
 * Shared prompt payload for Debug diagnostics and HTTP adapter input.
 * Resolves the active mode system prompt and thread context in one call.
 */
export function buildThreadProviderRequest(
  thread: ChatThreadSnapshot,
  workspaceRootPath: string,
  settings: AppSettingsState,
  scopeKind: ChatModePromptScopeKind,
): ProviderRequestPayload {
  const resolvedMode = resolveChatMode(thread.metadata.mode, settings);
  const summary = thread.metadata.summary?.trim();
  return buildProviderRequest({
    mode: resolvedMode.id,
    provider: thread.metadata.provider ?? "http",
    workspaceRootPath,
    summary,
    recentMessages: thread.messages,
    systemPrompt: resolveModeSystemText(resolvedMode, {
      workspaceRootPath,
      workspaceName: scopeKind === "chat-http" ? "Chats" : workspaceRootPath.split("/").pop() || workspaceRootPath,
      summary,
      scopeKind,
    }),
  });
}

/** Ensures manual prompt assembly matches the shared thread builder. */
export function buildProviderRequestWithMode(
  input: Parameters<typeof buildProviderRequest>[0] & {
    settings: AppSettingsState;
    scopeKind: ChatModePromptScopeKind;
  },
): ProviderRequestPayload {
  const resolvedMode = resolveChatMode(input.mode, input.settings);
  const summary = input.summary?.trim();
  return buildProviderRequest({
    ...input,
    mode: resolvedMode.id,
    summary,
    systemPrompt: resolveModeSystemText(resolvedMode, {
      workspaceRootPath: input.workspaceRootPath,
      workspaceName:
        input.scopeKind === "chat-http"
          ? "Chats"
          : input.workspaceRootPath.split("/").pop() || input.workspaceRootPath,
      summary,
      scopeKind: input.scopeKind,
    }),
  });
}
