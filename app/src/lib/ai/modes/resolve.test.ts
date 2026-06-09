import { describe, expect, it } from "vitest";
import type { AppSettingsState } from "../../domain/contracts";
import { defaultSettings } from "../../state/appState/settingsSlice";
import {
  PRESET_CUSTOM_MODE_IDS,
  defaultChatModesSettings,
  normalizeChatModesSettings,
} from "./chatModesSettings";
import { listSelectableChatModes, normalizeThreadChatModeId, resolveChatMode } from "./resolve";

function settingsWith(overrides: Partial<AppSettingsState["chatModes"]>): AppSettingsState {
  return {
    ...defaultSettings,
    chatModes: normalizeChatModesSettings({
      ...defaultSettings.chatModes,
      ...overrides,
    }),
  };
}

describe("resolveChatMode", () => {
  it("returns Ask for missing custom id", () => {
    const resolved = resolveChatMode("custom-missing-mode", defaultSettings);
    expect(resolved.id).toBe("ask");
    expect(resolved.source).toBe("builtin");
  });

  it("returns Ask for disabled custom mode", () => {
    const settings = settingsWith({
      customModes: defaultSettings.chatModes.customModes.map((mode) =>
        mode.id === PRESET_CUSTOM_MODE_IDS.ideation ? { ...mode, enabled: false } : mode,
      ),
    });

    const resolved = resolveChatMode(PRESET_CUSTOM_MODE_IDS.ideation, settings);
    expect(resolved.id).toBe("ask");
  });

  it("returns Ask when raw is disabled", () => {
    const resolved = resolveChatMode("raw", defaultSettings);
    expect(resolved.id).toBe("ask");
  });

  it("resolves enabled custom mode", () => {
    const resolved = resolveChatMode(PRESET_CUSTOM_MODE_IDS.criticalAnalysis, defaultSettings);
    expect(resolved.id).toBe(PRESET_CUSTOM_MODE_IDS.criticalAnalysis);
    expect(resolved.source).toBe("custom");
    expect(resolved.requiredSections).toEqual([
      "Summary",
      "Strengths",
      "Weaknesses",
      "Open questions",
    ]);
  });

  it("resolves raw when enabled", () => {
    const settings = settingsWith({ rawEnabled: true });
    const resolved = resolveChatMode("raw", settings);
    expect(resolved.id).toBe("raw");
    expect(resolved.promptTemplate).toBe("{{workspace}}\n{{summary}}");
  });
});

describe("listSelectableChatModes", () => {
  it("omits Raw when rawEnabled is false", () => {
    const modes = listSelectableChatModes(defaultSettings);
    expect(modes.map((mode) => mode.id)).not.toContain("raw");
    expect(modes.map((mode) => mode.id)).toContain("ask");
    expect(modes.map((mode) => mode.id)).toContain("review");
  });

  it("includes Raw when rawEnabled is true", () => {
    const modes = listSelectableChatModes(settingsWith({ rawEnabled: true }));
    expect(modes.map((mode) => mode.id)).toContain("raw");
  });

  it("includes enabled custom presets", () => {
    const modes = listSelectableChatModes(defaultSettings);
    expect(modes.map((mode) => mode.id)).toContain(PRESET_CUSTOM_MODE_IDS.ideation);
    expect(modes.map((mode) => mode.id)).toContain(PRESET_CUSTOM_MODE_IDS.executiveSummary);
  });
});

describe("default chat mode settings", () => {
  it("seeds formal presets with expected sections", () => {
    const critical = defaultChatModesSettings.customModes.find(
      (mode) => mode.id === PRESET_CUSTOM_MODE_IDS.criticalAnalysis,
    );
    const technical = defaultChatModesSettings.customModes.find(
      (mode) => mode.id === PRESET_CUSTOM_MODE_IDS.technicalSpecification,
    );
    const executive = defaultChatModesSettings.customModes.find(
      (mode) => mode.id === PRESET_CUSTOM_MODE_IDS.executiveSummary,
    );
    const ideation = defaultChatModesSettings.customModes.find(
      (mode) => mode.id === PRESET_CUSTOM_MODE_IDS.ideation,
    );

    expect(ideation?.requiredSections).toEqual([]);
    expect(critical?.requiredSections).toEqual([
      "Summary",
      "Strengths",
      "Weaknesses",
      "Open questions",
    ]);
    expect(technical?.requiredSections).toEqual([
      "Overview",
      "Requirements",
      "Constraints",
      "Open questions",
    ]);
    expect(executive?.requiredSections).toEqual([
      "Summary",
      "Key points",
      "Recommendations",
    ]);
  });

  it("normalizes partial persisted chat mode settings", () => {
    const normalized = normalizeChatModesSettings({
      rawEnabled: true,
      customModes: [{ id: "custom-test", name: "Test", prompt: "Hi", enabled: true }],
    });

    expect(normalized.rawEnabled).toBe(true);
    expect(normalized.customModes).toHaveLength(1);
    expect(normalized.customModes[0]?.id).toBe("custom-test");
    expect(normalized.builtinToggles.ask.includeWorkspace).toBe(true);
  });
});

describe("normalizeThreadChatModeId", () => {
  it("falls back to ask for missing custom mode", () => {
    expect(normalizeThreadChatModeId("custom-missing", defaultSettings)).toBe("ask");
  });

  it("keeps enabled custom mode id", () => {
    expect(normalizeThreadChatModeId(PRESET_CUSTOM_MODE_IDS.ideation, defaultSettings)).toBe(
      PRESET_CUSTOM_MODE_IDS.ideation,
    );
  });
});
