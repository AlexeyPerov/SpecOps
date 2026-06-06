import { describe, expect, it } from "vitest";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import {
  ASK_MODE_SYSTEM_PROMPT,
  REVIEW_EFFORT_ESTIMATE_GUIDANCE,
  REVIEW_MODE_SYSTEM_PROMPT,
  REVIEW_REQUIRED_SECTIONS,
  getChatMode,
  listBuiltinChatModes,
  listModesForProvider,
  resolveModeSystemPrompt,
} from "./builtins";
import { buildProviderRequestWithMode, buildThreadProviderRequest } from "./prompt";
import { buildProviderRequest } from "../providers/types";

function threadSnapshot(mode: ChatThreadSnapshot["metadata"]["mode"]): ChatThreadSnapshot {
  return {
    metadata: {
      agentId: "agent-test",
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
  it("registers ask and review with metadata", () => {
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
    ]);
  });

  it("resolves mode definitions by id", () => {
    expect(getChatMode("ask").label).toBe("Ask");
    expect(getChatMode("review").outputStyle).toBe("structured-review");
    expect(resolveModeSystemPrompt("review")).toBe(REVIEW_MODE_SYSTEM_PROMPT);
  });

  it("filters modes by provider-supported ids", () => {
    expect(listModesForProvider(["ask"]).map((mode) => mode.id)).toEqual(["ask"]);
    expect(listModesForProvider(["ask", "review"]).map((mode) => mode.id)).toEqual([
      "ask",
      "review",
    ]);
  });

  it("requires review sections and T-shirt/confidence wording in the system prompt", () => {
    for (const section of REVIEW_REQUIRED_SECTIONS) {
      expect(REVIEW_MODE_SYSTEM_PROMPT).toContain(section);
    }
    expect(REVIEW_MODE_SYSTEM_PROMPT).toContain("## Summary");
    expect(REVIEW_MODE_SYSTEM_PROMPT).toContain("## Critique");
    expect(REVIEW_MODE_SYSTEM_PROMPT).toContain("## Risk / effort estimate");
    expect(REVIEW_MODE_SYSTEM_PROMPT).toContain("## Open questions");
    expect(REVIEW_MODE_SYSTEM_PROMPT).toContain(REVIEW_EFFORT_ESTIMATE_GUIDANCE);
    expect(REVIEW_EFFORT_ESTIMATE_GUIDANCE).toMatch(/T-shirt size/i);
    expect(REVIEW_EFFORT_ESTIMATE_GUIDANCE).toMatch(/confidence level/i);
  });
});

describe("mode-aware prompt assembly", () => {
  it("builds identical payloads via buildThreadProviderRequest and manual mode resolution", () => {
    const thread = threadSnapshot("review");

    const fromThread = buildThreadProviderRequest(thread, "/work/spec-ops");
    const manual = buildProviderRequest({
      mode: "review",
      provider: "http",
      workspaceRootPath: "/work/spec-ops",
      summary: "Earlier context",
      recentMessages: thread.messages,
      systemPrompt: resolveModeSystemPrompt("review"),
    });

    expect(fromThread).toEqual(manual);
    expect(fromThread.systemPrompt).toBe(REVIEW_MODE_SYSTEM_PROMPT);
  });

  it("uses ask mode template for ask threads", () => {
    const payload = buildThreadProviderRequest(threadSnapshot("ask"), "/work/a");

    expect(payload.mode).toBe("ask");
    expect(payload.systemPrompt).toBe(ASK_MODE_SYSTEM_PROMPT);
  });

  it("matches buildProviderRequestWithMode for direct inputs", () => {
    const input = {
      mode: "review" as const,
      provider: "debug-workspace" as const,
      workspaceRootPath: "/work/a",
      recentMessages: threadSnapshot("review").messages,
    };

    expect(buildProviderRequestWithMode(input)).toEqual(
      buildProviderRequest({
        ...input,
        systemPrompt: REVIEW_MODE_SYSTEM_PROMPT,
      }),
    );
  });
});
