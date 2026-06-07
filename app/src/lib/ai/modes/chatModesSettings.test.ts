import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../state/appState/settingsSlice";
import { decodeChatAgentThreadFileSnapshot } from "../../services/chatPersistence";
import { isPersistedChatModeId, normalizeChatModesSettings } from "./chatModesSettings";

describe("chat mode persistence validation", () => {
  it("accepts builtin and custom mode ids", () => {
    expect(isPersistedChatModeId("ask")).toBe(true);
    expect(isPersistedChatModeId("review")).toBe(true);
    expect(isPersistedChatModeId("raw")).toBe(true);
    expect(isPersistedChatModeId("custom-preset-ideation")).toBe(true);
    expect(isPersistedChatModeId("invalid")).toBe(false);
  });

  it("normalizes unknown thread mode ids to ask on load", () => {
    const raw = JSON.stringify({
      version: 1,
      thread: {
        metadata: {
          agentId: "agent-1",
          threadId: "agent-1",
          mode: "not-a-mode",
          provider: "http",
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        },
        messages: [],
      },
    });

    const decoded = decodeChatAgentThreadFileSnapshot(raw);
    expect(decoded?.thread.metadata.mode).toBe("ask");
  });

  it("preserves custom mode ids on load", () => {
    const raw = JSON.stringify({
      version: 1,
      thread: {
        metadata: {
          agentId: "agent-1",
          threadId: "agent-1",
          mode: "custom-preset-ideation",
          provider: "http",
          createdAt: "2026-06-07T00:00:00.000Z",
          updatedAt: "2026-06-07T00:00:01.000Z",
        },
        messages: [],
      },
    });

    const decoded = decodeChatAgentThreadFileSnapshot(raw);
    expect(decoded?.thread.metadata.mode).toBe("custom-preset-ideation");
  });
});

describe("settings slice chat mode defaults", () => {
  it("includes chatModes in default settings", () => {
    expect(defaultSettings.chatModes.rawEnabled).toBe(false);
    expect(defaultSettings.chatModes.customModes.length).toBeGreaterThanOrEqual(4);
    expect(normalizeChatModesSettings(undefined)).toEqual(defaultSettings.chatModes);
  });
});
