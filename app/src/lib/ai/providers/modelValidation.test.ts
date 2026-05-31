import { describe, expect, it } from "vitest";
import type { ChatThreadSnapshot } from "../../domain/contracts";
import { ChatProviderError } from "./errors";
import {
  isProviderModelRejectionMessage,
  mapProviderModelRuntimeError,
  resolveEffectiveThreadModelId,
  shouldMapProviderModelRejection,
  validateLocalModelSelection,
} from "./modelValidation";
import { defaultProviderModelCatalogs } from "./providerModelCatalog";

function threadSnapshot(overrides?: Partial<ChatThreadSnapshot["metadata"]>): ChatThreadSnapshot {
  return {
    metadata: {
      agentId: "agent-test",
      threadId: "agent-test",
      mode: "ask",
      provider: "glm",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:01.000Z",
      ...overrides,
    },
    messages: [],
  };
}

describe("resolveEffectiveThreadModelId", () => {
  it("uses thread selected model when present", () => {
    expect(
      resolveEffectiveThreadModelId(
        threadSnapshot({ selectedModelId: "glm-4-plus" }),
        defaultProviderModelCatalogs,
      ),
    ).toBe("glm-4-plus");
  });

  it("falls back to provider catalog default", () => {
    expect(resolveEffectiveThreadModelId(threadSnapshot(), defaultProviderModelCatalogs)).toBe(
      "glm-4-flash",
    );
  });
});

describe("validateLocalModelSelection", () => {
  it("accepts models present in the provider catalog", () => {
    expect(
      validateLocalModelSelection(defaultProviderModelCatalogs, "glm", "glm-4-air"),
    ).toEqual({ ok: true, modelId: "glm-4-air" });
  });

  it("blocks models missing from the provider catalog", () => {
    const result = validateLocalModelSelection(
      defaultProviderModelCatalogs,
      "glm",
      "glm-unknown",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("glm-unknown");
      expect(result.recoveryHint).toContain("Settings");
    }
  });
});

describe("provider model rejection mapping", () => {
  it("detects model-related provider error messages", () => {
    expect(isProviderModelRejectionMessage("Model not found: glm-unknown")).toBe(true);
    expect(isProviderModelRejectionMessage("Invalid API key")).toBe(false);
  });

  it("maps provider model rejection to user-safe copy", () => {
    const mapped = mapProviderModelRuntimeError(
      new ChatProviderError("Model not found", "Model not found"),
      "glm",
      "glm-unknown",
    );

    expect(mapped.userMessage).toContain('glm-unknown');
    expect(mapped.userMessage).toContain("Settings");
  });

  it("requires both status and message for glm http mapping", () => {
    expect(shouldMapProviderModelRejection(404, "Model not found")).toBe(true);
    expect(shouldMapProviderModelRejection(401, "Model not found")).toBe(false);
  });
});
