import type { ChatModeId } from "../../domain/contracts";

export type ChatModeOutputStyle = "conversational" | "structured-review";

export interface ChatModeDefinition {
  id: ChatModeId;
  label: string;
  outputStyle: ChatModeOutputStyle;
  systemPrompt: string;
}

/** Required review response sections per MVP requirements. */
export const REVIEW_REQUIRED_SECTIONS = [
  "Summary",
  "Critique",
  "Risk / effort estimate",
  "Open questions",
] as const;

/** Wording enforced in the review mode system prompt for effort estimates. */
export const REVIEW_EFFORT_ESTIMATE_GUIDANCE =
  "T-shirt size (S, M, L, or XL) and confidence level (low, medium, or high)";

export const ASK_MODE_SYSTEM_PROMPT = [
  "You are a helpful workspace assistant.",
  "Answer questions directly with clear explanations about the user's workspace, code, and ideas.",
  "Be concise unless the user asks for detail.",
].join(" ");

export const REVIEW_MODE_SYSTEM_PROMPT = [
  "You are a critical reviewer for workspace ideas and proposals.",
  "Challenge assumptions, identify risks and tradeoffs, estimate effort, and ask clarifying questions.",
  "",
  "Structure every response with these sections (use the headings exactly):",
  "## Summary",
  "## Critique",
  "## Risk / effort estimate",
  `Include ${REVIEW_EFFORT_ESTIMATE_GUIDANCE}.`,
  "## Open questions",
].join("\n");

const BUILTIN_CHAT_MODES: readonly ChatModeDefinition[] = [
  {
    id: "ask",
    label: "Ask",
    outputStyle: "conversational",
    systemPrompt: ASK_MODE_SYSTEM_PROMPT,
  },
  {
    id: "review",
    label: "Review",
    outputStyle: "structured-review",
    systemPrompt: REVIEW_MODE_SYSTEM_PROMPT,
  },
];

const modesById = new Map<ChatModeId, ChatModeDefinition>(
  BUILTIN_CHAT_MODES.map((mode) => [mode.id, mode]),
);

export function listBuiltinChatModes(): readonly ChatModeDefinition[] {
  return BUILTIN_CHAT_MODES;
}

export function getChatMode(id: ChatModeId): ChatModeDefinition {
  const mode = modesById.get(id);
  if (!mode) {
    throw new Error(`Unknown chat mode: ${id}`);
  }
  return mode;
}

export function resolveModeSystemPrompt(id: ChatModeId): string {
  return getChatMode(id).systemPrompt;
}

export function listModesForProvider(supportedModes: readonly ChatModeId[]): ChatModeDefinition[] {
  const allowed = new Set(supportedModes);
  return BUILTIN_CHAT_MODES.filter((mode) => allowed.has(mode.id));
}
