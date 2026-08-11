import { beforeEach, describe, expect, it } from "vitest";
import { chatStore } from "../chatStore";

describe("chatStore opencode workspace metadata", () => {
  beforeEach(() => {
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  it("stores opencodeAgentId via updateThreadMetadata", () => {
    expect(chatStore.getMetadata()?.opencodeAgentId).toBeUndefined();
    const updated = chatStore.updateThreadMetadata({ opencodeAgentId: "build" });
    expect(updated).toBe(true);
    expect(chatStore.getMetadata()?.opencodeAgentId).toBe("build");
  });

  it("stores opencodeProviderId via updateThreadMetadata", () => {
    expect(chatStore.getMetadata()?.opencodeProviderId).toBeUndefined();
    const updated = chatStore.updateThreadMetadata({ opencodeProviderId: "anthropic" });
    expect(updated).toBe(true);
    expect(chatStore.getMetadata()?.opencodeProviderId).toBe("anthropic");
  });

  it("updates opencodeAgentId independently from opencodeProviderId", () => {
    chatStore.updateThreadMetadata({ opencodeAgentId: "plan", opencodeProviderId: "openai" });
    chatStore.updateThreadMetadata({ opencodeAgentId: "build" });
    expect(chatStore.getMetadata()?.opencodeAgentId).toBe("build");
    expect(chatStore.getMetadata()?.opencodeProviderId).toBe("openai");
  });

  it("preserves opencode fields alongside existing metadata", () => {
    chatStore.updateThreadMetadata({ selectedModelId: "claude-4" });
    chatStore.updateThreadMetadata({ opencodeAgentId: "build", opencodeProviderId: "anthropic" });
    const meta = chatStore.getMetadata();
    expect(meta?.selectedModelId).toBe("claude-4");
    expect(meta?.opencodeAgentId).toBe("build");
    expect(meta?.opencodeProviderId).toBe("anthropic");
  });
});
