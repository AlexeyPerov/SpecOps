import { beforeEach, describe, expect, it } from "vitest";
import { chatStore } from "../chatStore";
import type { SessionBinding } from "./sessions";

function seedSession(sessionId: string): void {
  chatStore.reset();
  chatStore.setActiveWorkspaceRoot("/work/binding");
  chatStore.createDraftSession();
  const active = chatStore.getActiveSessionId();
  expect(active).toBe(sessionId);
}

function binding(overrides: Partial<SessionBinding> = {}): SessionBinding {
  return {
    runtimeId: "fake",
    nativeSessionId: "fake-native-1",
    ...overrides,
  };
}

describe("chatStore session binding (neutral native link)", () => {
  beforeEach(() => {
    seedSession("session-1");
  });

  it("returns null link for unbound sessions", () => {
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toBeNull();
  });

  it("sets and reads a neutral binding", () => {
    const changed = chatStore.setSessionLink(
      "session-1",
      binding({ modelId: "fake-model" }),
      "/work/binding",
    );
    expect(changed).toBe(true);
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toEqual({
      runtimeId: "fake",
      nativeSessionId: "fake-native-1",
      modelId: "fake-model",
    });
  });

  it("rejects re-linking a bound session to a different runtime (immutable binding)", () => {
    chatStore.setSessionLink("session-1", binding(), "/work/binding");
    const changed = chatStore.setSessionLink(
      "session-1",
      binding({ runtimeId: "opencode", nativeSessionId: "other-native" }),
      "/work/binding",
    );
    expect(changed).toBe(false);
    // Original binding untouched.
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toEqual(
      binding(),
    );
  });

  it("rejects re-linking a bound session to a different native session on the same runtime", () => {
    chatStore.setSessionLink("session-1", binding(), "/work/binding");
    const changed = chatStore.setSessionLink(
      "session-1",
      binding({ nativeSessionId: "fake-native-2" }),
      "/work/binding",
    );
    expect(changed).toBe(false);
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toEqual(binding());
  });

  it("still updates mutable hint fields on a bound session", () => {
    chatStore.setSessionLink("session-1", binding(), "/work/binding");
    const changed = chatStore.setSessionLink(
      "session-1",
      binding({ modelId: "fake-model-2" }),
      "/work/binding",
    );
    expect(changed).toBe(true);
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toEqual(
      binding({ modelId: "fake-model-2" }),
    );
  });

  it("rejects unknown runtime ids", () => {
    const changed = chatStore.setSessionLink(
      "session-1",
      binding({ runtimeId: "not-a-runtime" as SessionBinding["runtimeId"] }),
      "/work/binding",
    );
    expect(changed).toBe(false);
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toBeNull();
  });

  it("clears the link via clearSessionLink", () => {
    chatStore.setSessionLink("session-1", binding({ modelId: "fake-model" }), "/work/binding");
    const cleared = chatStore.clearSessionLink("session-1", "/work/binding");
    expect(cleared).toBe(true);
    expect(chatStore.getSessionLink("session-1", "/work/binding")).toBeNull();
  });

  it("persists the neutral binding through the index codec round-trip", async () => {
    chatStore.setSessionLink(
      "session-1",
      binding({ modelId: "fake-model", parentSessionId: "fake-native-0" }),
      "/work/binding",
    );
    const index = chatStore.getSessionIndex();
    expect(index[0]).toMatchObject({
      id: "session-1",
      runtimeId: "fake",
      nativeSessionId: "fake-native-1",
      modelId: "fake-model",
      parentSessionId: "fake-native-0",
    });
  });
});
