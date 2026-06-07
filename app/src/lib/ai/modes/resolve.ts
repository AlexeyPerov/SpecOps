import type {
  AppSettingsState,
  BuiltinChatModeId,
  ChatModeId,
  CustomChatModeDefinition,
} from "../../domain/contracts";
import {
  ASK_MODE_SYSTEM_PROMPT,
  RAW_MODE_SYSTEM_PROMPT,
  REVIEW_REQUIRED_SECTIONS,
  REVIEW_MODE_SYSTEM_PROMPT,
  getBuiltinChatMode,
  listBuiltinChatModes,
} from "./builtins";
import { isBuiltinChatModeId } from "./chatModesSettings";

export type ResolvedChatModeSource = "builtin" | "custom";

export interface ResolvedChatMode {
  id: ChatModeId;
  name: string;
  source: ResolvedChatModeSource;
  editable: boolean;
  enabled: boolean;
  promptTemplate: string;
  includeWorkspace: boolean;
  includeSummary: boolean;
  requiredSections: readonly string[];
  sectionGuidance?: string;
}

function resolveBuiltinAsk(settings: AppSettingsState): ResolvedChatMode {
  const mode = getBuiltinChatMode("ask");
  const toggles = settings.chatModes.builtinToggles.ask;
  return {
    id: "ask",
    name: mode.label,
    source: "builtin",
    editable: false,
    enabled: true,
    promptTemplate: ASK_MODE_SYSTEM_PROMPT,
    includeWorkspace: toggles.includeWorkspace,
    includeSummary: toggles.includeSummary,
    requiredSections: [],
  };
}

function resolveBuiltinReview(settings: AppSettingsState): ResolvedChatMode {
  const mode = getBuiltinChatMode("review");
  const toggles = settings.chatModes.builtinToggles.review;
  return {
    id: "review",
    name: mode.label,
    source: "builtin",
    editable: false,
    enabled: true,
    promptTemplate: REVIEW_MODE_SYSTEM_PROMPT,
    includeWorkspace: toggles.includeWorkspace,
    includeSummary: toggles.includeSummary,
    requiredSections: REVIEW_REQUIRED_SECTIONS,
  };
}

function resolveBuiltinRaw(settings: AppSettingsState): ResolvedChatMode {
  const mode = getBuiltinChatMode("raw");
  const toggles = settings.chatModes.builtinToggles.raw;
  return {
    id: "raw",
    name: mode.label,
    source: "builtin",
    editable: false,
    enabled: settings.chatModes.rawEnabled,
    promptTemplate: RAW_MODE_SYSTEM_PROMPT,
    includeWorkspace: toggles.includeWorkspace,
    includeSummary: toggles.includeSummary,
    requiredSections: [],
  };
}

function resolveCustomMode(custom: CustomChatModeDefinition): ResolvedChatMode {
  return {
    id: custom.id,
    name: custom.name,
    source: "custom",
    editable: true,
    enabled: custom.enabled,
    promptTemplate: custom.prompt,
    includeWorkspace: custom.includeWorkspace,
    includeSummary: custom.includeSummary,
    requiredSections: custom.requiredSections,
    sectionGuidance: custom.sectionGuidance,
  };
}

function resolveBuiltinById(id: BuiltinChatModeId, settings: AppSettingsState): ResolvedChatMode {
  switch (id) {
    case "ask":
      return resolveBuiltinAsk(settings);
    case "review":
      return resolveBuiltinReview(settings);
    case "raw":
      return settings.chatModes.rawEnabled ? resolveBuiltinRaw(settings) : resolveBuiltinAsk(settings);
  }
}

/**
 * Resolves a thread or composer mode id against current settings.
 * Unknown, missing, or disabled modes fall back to Ask.
 */
export function resolveChatMode(id: ChatModeId, settings: AppSettingsState): ResolvedChatMode {
  if (isBuiltinChatModeId(id)) {
    return resolveBuiltinById(id, settings);
  }

  const custom = settings.chatModes.customModes.find((mode) => mode.id === id);
  if (!custom || !custom.enabled) {
    return resolveBuiltinAsk(settings);
  }

  return resolveCustomMode(custom);
}

/** Enabled built-ins (including Raw when enabled) plus enabled custom modes for composer selection. */
export function listSelectableChatModes(settings: AppSettingsState): ResolvedChatMode[] {
  const selectable: ResolvedChatMode[] = [
    resolveBuiltinAsk(settings),
    resolveBuiltinReview(settings),
  ];

  if (settings.chatModes.rawEnabled) {
    selectable.push(resolveBuiltinRaw(settings));
  }

  for (const custom of settings.chatModes.customModes) {
    if (custom.enabled) {
      selectable.push(resolveCustomMode(custom));
    }
  }

  return selectable;
}

/** Maps a persisted thread mode to a valid selectable id, falling back to Ask when needed. */
export function normalizeThreadChatModeId(id: ChatModeId, settings: AppSettingsState): ChatModeId {
  const resolved = resolveChatMode(id, settings);
  if (resolved.id === "ask" && id !== "ask" && id !== "review") {
    return "ask";
  }
  if (id === "raw" && !settings.chatModes.rawEnabled) {
    return "ask";
  }
  if (!isBuiltinChatModeId(id)) {
    const custom = settings.chatModes.customModes.find((mode) => mode.id === id);
    if (!custom || !custom.enabled) {
      return "ask";
    }
  }
  return id;
}

export function listBuiltinResolvedChatModes(settings: AppSettingsState): ResolvedChatMode[] {
  return listBuiltinChatModes().map((mode) => resolveBuiltinById(mode.id, settings));
}
