import type {
  BuiltinChatModeId,
  BuiltinChatModeToggles,
  ChatModeContextToggles,
  ChatModeId,
  ChatModesSettings,
  CustomChatModeDefinition,
} from "../../domain/contracts";

const BUILTIN_CHAT_MODE_IDS: readonly BuiltinChatModeId[] = ["ask", "review", "raw"];

const DEFAULT_CONTEXT_TOGGLES: ChatModeContextToggles = {
  includeWorkspace: true,
  includeSummary: true,
};

export const defaultBuiltinModeToggles: BuiltinChatModeToggles = {
  ask: { ...DEFAULT_CONTEXT_TOGGLES },
  review: { ...DEFAULT_CONTEXT_TOGGLES },
  raw: { ...DEFAULT_CONTEXT_TOGGLES },
};

/** Stable preset ids seeded on first run only (via defaultSettings). */
export const PRESET_CUSTOM_MODE_IDS = {
  ideation: "custom-preset-ideation",
  criticalAnalysis: "custom-preset-critical-analysis",
  technicalSpecification: "custom-preset-technical-specification",
  executiveSummary: "custom-preset-executive-summary",
} as const;

export const defaultCustomModePresets: CustomChatModeDefinition[] = [
  {
    id: PRESET_CUSTOM_MODE_IDS.ideation,
    name: "Ideation",
    prompt: [
      "You are a creative brainstorming partner.",
      "Generate diverse ideas, explore alternatives, and build on the user's direction.",
      "Be concise unless the user asks for detail.",
    ].join(" "),
    enabled: true,
    includeWorkspace: true,
    includeSummary: true,
    requiredSections: [],
  },
  {
    id: PRESET_CUSTOM_MODE_IDS.criticalAnalysis,
    name: "Critical analysis",
    prompt: [
      "You are a rigorous analyst reviewing ideas and proposals.",
      "Identify strengths, weaknesses, and open questions with clear reasoning.",
    ].join(" "),
    enabled: true,
    includeWorkspace: true,
    includeSummary: true,
    requiredSections: ["Summary", "Strengths", "Weaknesses", "Open questions"],
  },
  {
    id: PRESET_CUSTOM_MODE_IDS.technicalSpecification,
    name: "Technical specification",
    prompt: [
      "You are a technical writer producing clear, actionable specifications.",
      "Focus on requirements, constraints, and unresolved questions.",
    ].join(" "),
    enabled: true,
    includeWorkspace: true,
    includeSummary: true,
    requiredSections: ["Overview", "Requirements", "Constraints", "Open questions"],
  },
  {
    id: PRESET_CUSTOM_MODE_IDS.executiveSummary,
    name: "Executive summary",
    prompt: [
      "You are an executive communicator distilling complex topics for decision-makers.",
      "Prioritize clarity, key points, and actionable recommendations.",
    ].join(" "),
    enabled: true,
    includeWorkspace: true,
    includeSummary: true,
    requiredSections: ["Summary", "Key points", "Recommendations"],
  },
];

export const defaultChatModesSettings: ChatModesSettings = {
  rawEnabled: false,
  builtinToggles: defaultBuiltinModeToggles,
  customModes: defaultCustomModePresets.map((mode) => ({ ...mode })),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeContextToggles(
  value: unknown,
  fallback: ChatModeContextToggles,
): ChatModeContextToggles {
  if (!isRecord(value)) {
    return { ...fallback };
  }
  return {
    includeWorkspace: normalizeBoolean(value.includeWorkspace, fallback.includeWorkspace),
    includeSummary: normalizeBoolean(value.includeSummary, fallback.includeSummary),
  };
}

function normalizeBuiltinToggles(value: unknown): BuiltinChatModeToggles {
  const source = isRecord(value) ? value : {};
  return {
    ask: normalizeContextToggles(source.ask, defaultBuiltinModeToggles.ask),
    review: normalizeContextToggles(source.review, defaultBuiltinModeToggles.review),
    raw: normalizeContextToggles(source.raw, defaultBuiltinModeToggles.raw),
  };
}

function normalizeRequiredSections(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sections: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      sections.push(trimmed);
    }
  }
  return sections;
}

function normalizeCustomModeId(value: unknown, fallbackId: string): string {
  if (typeof value !== "string") {
    return fallbackId;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallbackId;
  }
  return trimmed;
}

export function isBuiltinChatModeId(value: string): value is BuiltinChatModeId {
  return (BUILTIN_CHAT_MODE_IDS as readonly string[]).includes(value);
}

/** Validates persisted custom mode ids (`custom-{slug}`). */
export function isCustomChatModeId(value: string): boolean {
  return /^custom-[a-z0-9-]+$/i.test(value);
}

/** Accepts built-in ids and persisted custom mode ids. */
export function isPersistedChatModeId(value: unknown): value is ChatModeId {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return isBuiltinChatModeId(value) || isCustomChatModeId(value);
}

export function createCustomChatModeId(): string {
  return `custom-${crypto.randomUUID()}`;
}

export function normalizeCustomChatModeDefinition(
  input: Partial<CustomChatModeDefinition> | unknown,
  fallbackId = createCustomChatModeId(),
): CustomChatModeDefinition {
  const source = isRecord(input) ? input : {};
  const id = normalizeCustomModeId(source.id, fallbackId);
  const name =
    typeof source.name === "string" && source.name.trim().length > 0
      ? source.name.trim()
      : "Untitled mode";
  const prompt = typeof source.prompt === "string" ? source.prompt : "";
  const sectionGuidance =
    typeof source.sectionGuidance === "string" && source.sectionGuidance.trim().length > 0
      ? source.sectionGuidance.trim()
      : undefined;

  return {
    id,
    name,
    prompt,
    enabled: normalizeBoolean(source.enabled, true),
    includeWorkspace: normalizeBoolean(source.includeWorkspace, true),
    includeSummary: normalizeBoolean(source.includeSummary, true),
    requiredSections: normalizeRequiredSections(source.requiredSections),
    sectionGuidance,
  };
}

/** Single load-time entry for chat mode settings normalization. */
export function normalizeChatModesSettings(input?: Partial<ChatModesSettings> | unknown): ChatModesSettings {
  const source = isRecord(input) ? input : {};
  const customModes = Array.isArray(source.customModes)
    ? source.customModes.map((entry) => normalizeCustomChatModeDefinition(entry))
    : defaultChatModesSettings.customModes.map((mode) => ({ ...mode }));

  return {
    rawEnabled: normalizeBoolean(source.rawEnabled, defaultChatModesSettings.rawEnabled),
    builtinToggles: normalizeBuiltinToggles(source.builtinToggles),
    customModes,
  };
}
