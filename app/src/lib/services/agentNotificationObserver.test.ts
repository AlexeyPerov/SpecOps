import { describe, expect, it, vi } from "vitest";
import { defaultSoundSettings } from "./notificationSettings";
import type {
  NotificationEventId,
  OsNotificationSettings,
  SoundSettings,
} from "../domain/contracts";
import type { ChatThreadRuntimeState } from "../state/chatStore/types";
import {
  createAgentNotificationObserver,
  deriveNotificationEvents,
  type NotificationSinks,
} from "./agentNotificationObserver";

function runtime(overrides: Partial<ChatThreadRuntimeState> = {}): ChatThreadRuntimeState {
  return {
    isGenerating: false,
    isWaitingForPermission: false,
    isWaitingForQuestion: false,
    lastFailedTurnId: null,
    lastError: null,
    activeTurnId: null,
    ...overrides,
  };
}

describe("deriveNotificationEvents", () => {
  it("emits agentDone when isGenerating goes true → false", () => {
    const prev = runtime({ isGenerating: true });
    const next = runtime({ isGenerating: false });
    expect(deriveNotificationEvents(prev, next)).toEqual<NotificationEventId[]>([
      "agentDone",
    ]);
  });

  it("does not emit agentDone on a fresh failure", () => {
    const prev = runtime({ isGenerating: true, lastFailedTurnId: null });
    const next = runtime({
      isGenerating: false,
      lastFailedTurnId: "turn-1",
    });
    expect(deriveNotificationEvents(prev, next)).toEqual<NotificationEventId[]>([
      "error",
    ]);
  });

  it("emits permission when isWaitingForPermission goes false → true", () => {
    const prev = runtime({ isGenerating: true });
    const next = runtime({
      isGenerating: true,
      isWaitingForPermission: true,
    });
    expect(deriveNotificationEvents(prev, next)).toEqual<NotificationEventId[]>([
      "permission",
    ]);
  });

  it("emits question when isWaitingForQuestion goes false → true", () => {
    const prev = runtime({ isGenerating: true });
    const next = runtime({
      isGenerating: true,
      isWaitingForQuestion: true,
    });
    expect(deriveNotificationEvents(prev, next)).toEqual<NotificationEventId[]>([
      "question",
    ]);
  });

  it("emits error when lastFailedTurnId changes", () => {
    const prev = runtime({ lastFailedTurnId: null });
    const next = runtime({ lastFailedTurnId: "turn-2" });
    expect(deriveNotificationEvents(prev, next)).toEqual<NotificationEventId[]>([
      "error",
    ]);
  });

  it("emits nothing when nothing changes", () => {
    const state = runtime({ isGenerating: true });
    expect(deriveNotificationEvents(state, state)).toEqual([]);
  });

  it("treats a missing previous state as the current baseline", () => {
    const state = runtime({ isGenerating: true });
    expect(deriveNotificationEvents(undefined, state)).toEqual([]);
  });

  it("emits multiple events when several transitions occur at once", () => {
    const prev = runtime({ isGenerating: true });
    const next = runtime({
      isGenerating: true,
      isWaitingForPermission: true,
      isWaitingForQuestion: true,
    });
    expect(deriveNotificationEvents(prev, next)).toEqual<NotificationEventId[]>([
      "permission",
      "question",
    ]);
  });
});

describe("createAgentNotificationObserver", () => {
  const sound: SoundSettings = { ...defaultSoundSettings };
  const osNotifications: OsNotificationSettings = {
    enabled: true,
    events: { agentDone: true, permission: true, question: true, error: true },
  };

  function observerWithMocks() {
    const playSound = vi.fn();
    const notifyOs = vi.fn();
    const sinks: NotificationSinks = { playSound, notifyOs };
    const observer = createAgentNotificationObserver(sinks);
    return { observer, playSound, notifyOs };
  }

  it("fires sound + OS notification on an agentDone transition", () => {
    const { observer, playSound, notifyOs } = observerWithMocks();

    observer.update({
      activeScopeKey: "/work",
      runtimeByAgentId: { "agent-1": runtime({ isGenerating: true }) },
      settings: { sound, osNotifications },
    });
    observer.update({
      activeScopeKey: "/work",
      runtimeByAgentId: { "agent-1": runtime({ isGenerating: false }) },
      settings: { sound, osNotifications },
    });

    expect(playSound).toHaveBeenCalledWith("agentDone", sound);
    expect(notifyOs).toHaveBeenCalledWith(
      "agentDone",
      osNotifications,
      expect.objectContaining({ title: expect.any(String) }),
    );
  });

  it("does not refire when the same runtime is reported twice", () => {
    const { observer, playSound } = observerWithMocks();
    const state = runtime({ isGenerating: true });

    observer.update({
      activeScopeKey: "/work",
      runtimeByAgentId: { "agent-1": state },
      settings: { sound, osNotifications },
    });
    observer.update({
      activeScopeKey: "/work",
      runtimeByAgentId: { "agent-1": state },
      settings: { sound, osNotifications },
    });

    expect(playSound).not.toHaveBeenCalled();
  });

  it("resets per-agent history when the active scope changes", () => {
    const { observer, playSound } = observerWithMocks();

    // Seed agent-1 as generating in scope A.
    observer.update({
      activeScopeKey: "/a",
      runtimeByAgentId: { "agent-1": runtime({ isGenerating: true }) },
      settings: { sound, osNotifications },
    });
    // Switch to scope B where agent-1 already finished — because history was
    // reset, this should NOT look like a true→false transition.
    observer.update({
      activeScopeKey: "/b",
      runtimeByAgentId: { "agent-1": runtime({ isGenerating: false }) },
      settings: { sound, osNotifications },
    });

    expect(playSound).not.toHaveBeenCalled();
  });

  it("observes every agent in the active workspace independently", () => {
    const { observer, playSound } = observerWithMocks();

    observer.update({
      activeScopeKey: "/work",
      runtimeByAgentId: {
        "agent-a": runtime({ isGenerating: true }),
        "agent-b": runtime({ isGenerating: true }),
      },
      settings: { sound, osNotifications },
    });
    observer.update({
      activeScopeKey: "/work",
      runtimeByAgentId: {
        "agent-a": runtime({ isGenerating: false }),
        "agent-b": runtime({ isGenerating: true }),
      },
      settings: { sound, osNotifications },
    });

    // Only agent-a completed.
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledWith("agentDone", sound);
  });

  it("uses defaults sinks when none are provided", () => {
    // Just ensure it constructs and update no-ops cleanly without injected sinks.
    const observer = createAgentNotificationObserver();
    expect(() =>
      observer.update({
        activeScopeKey: "/work",
        runtimeByAgentId: { "agent-1": runtime({ isGenerating: true }) },
        settings: { sound, osNotifications },
      }),
    ).not.toThrow();
    observer.dispose();
  });
});
