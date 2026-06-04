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
      provider: "http",
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
        threadSnapshot({ selectedModelId: "gpt-4.1" }),
        defaultProviderModelCatalogs,
      ),
    ).toBe("gpt-4.1");
  });

  it("falls back to provider catalog default", () => {
    expect(resolveEffectiveThreadModelId(threadSnapshot(), defaultProviderModelCatalogs)).toBe(
      "gpt-4o-mini",
    );
  });
});

describe("validateLocalModelSelection", () => {
  it("accepts models present in the provider catalog", () => {
    const catalogs = {
      ...defaultProviderModelCatalogs,
      http: {
        modelIds: ["gpt-4o-mini", "gpt-4.1-mini"],
        defaultModelId: "gpt-4o-mini",
      },
    };
    expect(
      validateLocalModelSelection(catalogs, "http", "gpt-4.1-mini"),
    ).toEqual({ ok: true, modelId: "gpt-4.1-mini" });
  });

  it("blocks models missing from the provider catalog", () => {
    const result = validateLocalModelSelection(
      defaultProviderModelCatalogs,
      "http",
      "unknown-model",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("unknown-model");
      expect(result.recoveryHint).toContain("Settings");
    }
  });
});

describe("provider model rejection mapping", () => {
  it("detects model-related provider error messages", () => {
    expect(isProviderModelRejectionMessage("Model not found: unknown-model")).toBe(true);
    expect(isProviderModelRejectionMessage("Invalid API key")).toBe(false);
  });

  it("maps provider model rejection to user-safe copy", () => {
    const mapped = mapProviderModelRuntimeError(
      new ChatProviderError("Model not found", "Model not found"),
      "http",
      "unknown-model",
    );

    expect(mapped.userMessage).toContain('unknown-model');
    expect(mapped.userMessage).toContain("Settings");
  });

  it("requires both status and message for glm http mapping", () => {
    expect(shouldMapProviderModelRejection(404, "Model not found")).toBe(true);
    expect(shouldMapProviderModelRejection(401, "Model not found")).toBe(false);
  });
});
