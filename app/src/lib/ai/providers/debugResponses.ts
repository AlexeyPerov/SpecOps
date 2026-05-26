import type { ChatModeId } from "../../domain/contracts";
import type { WorkspaceAccessStatus } from "../capabilities";
import type { DebugTurnSimulationPlan } from "./debugSimulation";
import type { ProviderRequestPayload } from "./types";

const PROMPT_PREVIEW_MAX_CHARS = 480;

export function buildDebugAskResponse(payload: ProviderRequestPayload): string {
  const lastUserMessage = [...payload.history].reverse().find((message) => message.role === "user");
  const topic = lastUserMessage?.content.trim() || "your workspace question";
  return [
    `Here's a concise simulated answer about ${truncateInline(topic, 120)}.`,
    "Debug provider response — no network call was made.",
  ].join(" ");
}

export function buildDebugReviewResponse(): string {
  return [
    "## Summary",
    "Simulated review of the latest workspace proposal.",
    "",
    "## Critique",
    "Assumptions deserve scrutiny; edge cases may be under-specified for this workspace context.",
    "",
    "## Risk / effort estimate",
    "T-shirt size: M · Confidence: medium",
    "",
    "## Open questions",
    "- What constraints should we validate first?",
    "- Which dependencies are still unknown?",
  ].join("\n");
}

export function buildDebugResponseBody(mode: ChatModeId, payload: ProviderRequestPayload): string {
  return mode === "review" ? buildDebugReviewResponse() : buildDebugAskResponse(payload);
}

export interface DebugDiagnosticsInput {
  payload: ProviderRequestPayload;
  accessStatus: WorkspaceAccessStatus;
  simulation: DebugTurnSimulationPlan;
}

export function buildDebugDiagnosticsAppendix(input: DebugDiagnosticsInput): string {
  const promptPreview = truncateMultiline(JSON.stringify(sanitizePromptPreview(input.payload)), PROMPT_PREVIEW_MAX_CHARS);
  return [
    "---",
    "Debug diagnostics",
    `Mode: ${input.payload.mode}`,
    `Workspace: ${input.payload.workspace.rootPath} (${input.payload.workspace.name})`,
    `Access: ${input.accessStatus}`,
    `Prompt preview: ${promptPreview}`,
    `Simulation: delay=${input.simulation.delayMs}ms, chunks=${input.simulation.chunkSizes.length}, failRoll=${formatRoll(input.simulation.failRoll)}`,
  ].join("\n");
}

function sanitizePromptPreview(payload: ProviderRequestPayload): ProviderRequestPayload {
  return {
    mode: payload.mode,
    provider: payload.provider,
    workspace: payload.workspace,
    summary: payload.summary,
    history: payload.history,
    systemPrompt: payload.systemPrompt,
  };
}

function truncateInline(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

function truncateMultiline(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

function formatRoll(value: number): string {
  return value.toFixed(4);
}

export function appendDebugDiagnostics(
  body: string,
  diagnostics: string,
  includeDiagnostics: boolean,
): string {
  if (!includeDiagnostics) {
    return body;
  }
  return `${body}\n\n${diagnostics}`;
}
