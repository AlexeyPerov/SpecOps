import { describe, expect, it } from "vitest";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import type { AppSettingsState } from "../../domain/contracts";
import { defaultSettings } from "../../state/appState/settingsSlice";
import {
  ASK_MODE_SYSTEM_PROMPT,
  RAW_MODE_SYSTEM_PROMPT,
  REVIEW_EFFORT_ESTIMATE_GUIDANCE,
  REVIEW_MODE_SYSTEM_PROMPT,
  REVIEW_REQUIRED_SECTIONS,
  getChatMode,
  listBuiltinChatModes,
  listModesForProvider,
} from "./builtins";
import {
  buildProviderRequestWithMode,
  buildThreadProviderRequest,
  resolveModeSystemText,
} from "./prompt";
import { buildProviderRequest } from "../providers/types";
import { resolveChatMode } from "./resolve";

function settingsWith(overrides: Partial<AppSettingsState["chatModes"]>): AppSettingsState {
  return {
    ...defaultSettings,
    chatModes: {
      ...defaultSettings.chatModes,
      ...overrides,
    },
  };
}

function threadSnapshot(mode: ChatThreadSnapshot["metadata"]["mode"]): ChatThreadSnapshot {
  return {
    metadata: {
      sessionId: "agent-test",
      threadId: "agent-test",
      mode,
      provider: "http",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:01.000Z",
      summary: "Earlier context",
    },
    messages: [
      {
        id: "u-1",
        role: "user",
        content: "question",
        createdAt: "2026-05-26T00:00:00.000Z",
      },
    ],
  };
}

describe("builtin chat modes", () => {
  it("registers ask, review, and raw with metadata", () => {
    expect(listBuiltinChatModes()).toEqual([
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
      {
        id: "raw",
        label: "Raw",
        outputStyle: "conversational",
        systemPrompt: RAW_MODE_SYSTEM_PROMPT,
      },
    ]);
  });

  it("resolves mode definitions by id", () => {
    expect(getChatMode("ask").label).toBe("Ask");
    expect(getChatMode("review").outputStyle).toBe("structured-review");
    expect(resolveChatMode("review", defaultSettings).promptTemplate).toBe(REVIEW_MODE_SYSTEM_PROMPT);
  });

  it("filters modes by provider-supported ids", () => {
    expect(listModesForProvider(["ask"]).map((mode) => mode.id)).toEqual(["ask"]);
    expect(listModesForProvider(["ask", "review"]).map((mode) => mode.id)).toEqual([
      "ask",
      "review",
    ]);
  });

  it("does not duplicate review sections in the built-in template", () => {
    expect(REVIEW_MODE_SYSTEM_PROMPT).not.toContain("## Summary");
    expect(REVIEW_MODE_SYSTEM_PROMPT).not.toContain("Structure every response");
  });

  it("requires review sections and T-shirt/confidence wording in resolved system text", () => {
    const prompt = resolveModeSystemText(resolveChatMode("review", defaultSettings), {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      scopeKind: "workspace",
    });

    for (const section of REVIEW_REQUIRED_SECTIONS) {
      expect(prompt).toContain(section);
    }
    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Critique");
    expect(prompt).toContain("## Risk / effort estimate");
    expect(prompt).toContain("## Open questions");
    expect(prompt).toContain(REVIEW_EFFORT_ESTIMATE_GUIDANCE);
    expect(REVIEW_EFFORT_ESTIMATE_GUIDANCE).toMatch(/T-shirt size/i);
    expect(REVIEW_EFFORT_ESTIMATE_GUIDANCE).toMatch(/confidence level/i);
  });
});

describe("mode-aware prompt assembly", () => {
  it("builds identical payloads via buildThreadProviderRequest and manual mode resolution", () => {
    const thread = threadSnapshot("review");
    const resolvedMode = resolveChatMode("review", defaultSettings);
    const expectedSystemText = resolveModeSystemText(resolvedMode, {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      summary: "Earlier context",
      scopeKind: "workspace",
    });

    const fromThread = buildThreadProviderRequest(
      thread,
      "/work/spec-ops",
      defaultSettings,
      "workspace",
    );
    const manual = buildProviderRequest({
      mode: "review",
      provider: "http",
      workspaceRootPath: "/work/spec-ops",
      summary: "Earlier context",
      recentMessages: thread.messages,
      systemPrompt: expectedSystemText,
    });

    expect(fromThread).toEqual(manual);
    expect(fromThread.systemPrompt).toContain("## Summary");
  });

  it("uses ask mode template for ask threads", () => {
    const payload = buildThreadProviderRequest(threadSnapshot("ask"), "/work/a", defaultSettings, "workspace");

    expect(payload.mode).toBe("ask");
    expect(payload.systemPrompt).toContain("helpful workspace assistant");
    expect(payload.systemPrompt).toContain("Workspace: a (/work/a)");
    expect(payload.systemPrompt).toContain("Earlier conversation summary:\nEarlier context");
  });

  it("matches buildProviderRequestWithMode for direct inputs", () => {
    const input = {
      mode: "review" as const,
      provider: "debug-workspace" as const,
      workspaceRootPath: "/work/a",
      recentMessages: threadSnapshot("review").messages,
      settings: defaultSettings,
      scopeKind: "workspace" as const,
    };

    const systemPrompt = resolveModeSystemText(resolveChatMode("review", defaultSettings), {
      workspaceRootPath: "/work/a",
      workspaceName: "a",
      scopeKind: "workspace",
    });

    expect(buildProviderRequestWithMode(input)).toEqual(
      buildProviderRequest({
        mode: "review",
        provider: "debug-workspace",
        workspaceRootPath: "/work/a",
        recentMessages: input.recentMessages,
        systemPrompt,
      }),
    );
  });

  it("omits workspace and summary when Ask toggles are disabled", () => {
    const askSettings = settingsWith({
      builtinToggles: {
        ...defaultSettings.chatModes.builtinToggles,
        ask: { includeWorkspace: false, includeSummary: false },
      },
    });
    const prompt = resolveModeSystemText(resolveChatMode("ask", askSettings), {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      summary: "Earlier context",
      scopeKind: "workspace",
    });

    expect(prompt).toContain("helpful workspace assistant");
    expect(prompt).not.toContain("Workspace:");
    expect(prompt).not.toContain("Earlier conversation summary:");
    expect(prompt).not.toContain("{{workspace}}");
    expect(prompt).not.toContain("{{summary}}");
  });

  it("substitutes built-in workspace and summary placeholders when toggles are on", () => {
    const prompt = resolveModeSystemText(resolveChatMode("ask", defaultSettings), {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      summary: "Compacted context",
      scopeKind: "workspace",
    });

    expect(prompt).toContain("Workspace: spec-ops (/work/spec-ops)");
    expect(prompt).toContain("Earlier conversation summary:\nCompacted context");
    expect(prompt).not.toContain("{{workspace}}");
    expect(prompt).not.toContain("{{summary}}");
  });

  it("substitutes custom placeholders from mode toggles", () => {
    const customId = defaultSettings.chatModes.customModes[0]?.id ?? "custom-ideation";
    const customSettings = settingsWith({
      customModes: [
        {
          id: customId,
          name: "Custom",
          prompt: "Context:\n{{workspace}}\n\nSummary:\n{{summary}}",
          enabled: true,
          includeWorkspace: true,
          includeSummary: true,
          requiredSections: [],
        },
      ],
    });
    const prompt = resolveModeSystemText(resolveChatMode(customId, customSettings), {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      summary: "Compacted context",
      scopeKind: "workspace",
    });

    expect(prompt).toContain("Workspace: spec-ops (/work/spec-ops)");
    expect(prompt).toContain("Earlier conversation summary:\nCompacted context");
  });

  it("keeps review required sections in resolved system text", () => {
    const prompt = resolveModeSystemText(resolveChatMode("review", defaultSettings), {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      scopeKind: "workspace",
    });

    expect(prompt).toContain("## Summary");
    expect(prompt).toContain("## Critique");
    expect(prompt).toContain("## Risk / effort estimate");
    expect(prompt).toContain("## Open questions");
  });

  it("does not inject ask persona text for raw mode", () => {
    const rawSettings = settingsWith({ rawEnabled: true });
    const prompt = resolveModeSystemText(resolveChatMode("raw", rawSettings), {
      workspaceRootPath: "/work/spec-ops",
      workspaceName: "spec-ops",
      summary: "Earlier context",
      scopeKind: "workspace",
    });

    expect(prompt).not.toContain("helpful workspace assistant");
  });
});
