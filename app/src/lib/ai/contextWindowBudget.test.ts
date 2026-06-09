import { describe, expect, it } from "vitest";
import { estimateContextWindowBudget, resolveEstimatedContextLimit } from "./contextWindowBudget";
import type { ChatThreadSnapshot } from "../domain/contracts";
import { defaultSettings } from "../state/appState/settingsSlice";

function threadSnapshot(): ChatThreadSnapshot {
  return {
    metadata: {
      agentId: "agent-1",
      threadId: "thread-1",
      mode: "ask",
      provider: "http",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
      selectedModelId: "gpt-4o-mini",
      summary: "Prior compacted context",
    },
    messages: [
      {
        id: "user-1",
        role: "user",
        content: "What should we do next?",
        createdAt: "2026-06-09T00:00:00.000Z",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Let's define a simple implementation slice first.",
        createdAt: "2026-06-09T00:00:01.000Z",
      },
    ],
  };
}

describe("resolveEstimatedContextLimit", () => {
  it("returns known limits for common model ids", () => {
    expect(resolveEstimatedContextLimit("gpt-4o-mini")).toBe(128_000);
    expect(resolveEstimatedContextLimit("foo-32k")).toBe(32_000);
    expect(resolveEstimatedContextLimit("bar-1m")).toBe(1_000_000);
  });

  it("returns undefined when no limit is known", () => {
    expect(resolveEstimatedContextLimit("debug-simulator")).toBeUndefined();
    expect(resolveEstimatedContextLimit("unknown-model")).toBeUndefined();
  });
});

describe("estimateContextWindowBudget", () => {
  it("includes draft tokens in estimate", () => {
    const thread = threadSnapshot();
    const withoutDraft = estimateContextWindowBudget({
      thread,
      workspaceRootPath: "/tmp/spec-ops",
      settings: defaultSettings,
      scopeKind: "workspace",
      draft: "",
    });
    const withDraft = estimateContextWindowBudget({
      thread,
      workspaceRootPath: "/tmp/spec-ops",
      settings: defaultSettings,
      scopeKind: "workspace",
      draft: "Please include task timings and owners.",
    });
    expect(withDraft.estimatedTokens).toBeGreaterThan(withoutDraft.estimatedTokens);
    expect(withDraft.estimatedLimitTokens).toBe(128_000);
  });
});
