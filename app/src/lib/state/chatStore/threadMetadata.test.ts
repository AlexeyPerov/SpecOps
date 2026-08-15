import { beforeEach, describe, expect, it } from "vitest";
import { chatStore } from "../chatStore";

describe("chatStore neutral workspace metadata", () => {
  beforeEach(() => {
    chatStore.reset();
    chatStore.setActiveWorkspaceRoot("/work/a");
  });

  it("stores selectedModeId via updateThreadMetadata", () => {
    expect(chatStore.getMetadata()?.selectedModeId).toBeUndefined();
    const updated = chatStore.updateThreadMetadata({ selectedModeId: "plan" });
    expect(updated).toBe(true);
    expect(chatStore.getMetadata()?.selectedModeId).toBe("plan");
  });

  it("stores runtimeId via updateThreadMetadata", () => {
    expect(chatStore.getMetadata()?.runtimeId).toBeUndefined();
    const updated = chatStore.updateThreadMetadata({ runtimeId: "fake" });
    expect(updated).toBe(true);
    expect(chatStore.getMetadata()?.runtimeId).toBe("fake");
  });

  it("updates selectedModeId independently from selectedModelId", () => {
    chatStore.updateThreadMetadata({ selectedModelId: "fake-model", selectedModeId: "default" });
    chatStore.updateThreadMetadata({ selectedModeId: "plan" });
    expect(chatStore.getMetadata()?.selectedModelId).toBe("fake-model");
    expect(chatStore.getMetadata()?.selectedModeId).toBe("plan");
  });

  it("preserves neutral fields alongside existing metadata", () => {
    chatStore.updateThreadMetadata({ selectedModelId: "fake-model" });
    chatStore.updateThreadMetadata({ selectedModeId: "plan", runtimeId: "fake" });
    const meta = chatStore.getMetadata();
    expect(meta?.selectedModelId).toBe("fake-model");
    expect(meta?.selectedModeId).toBe("plan");
    expect(meta?.runtimeId).toBe("fake");
  });
});
