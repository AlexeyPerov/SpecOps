import { afterEach, describe, expect, it } from "vitest";
import {
  assertRuntimeImmutable,
  createSessionRef,
  isTerminalSessionStatus,
  TERMINAL_SESSION_STATUSES,
  rebindRuntime,
  rehydrateSessionRef,
  SessionBindingError,
  updateSessionRef,
  type CreateSessionRefInput,
} from "./binding";
import {
  asNativeSessionId,
  asSpecOpsSessionId,
  mintSpecOpsSessionId,
  resetSessionIdCountersForTests,
} from "./ids";
import type { AgentRuntimeId } from "./runtime";

afterEach(() => {
  resetSessionIdCountersForTests();
});

function baseInput(overrides: Partial<CreateSessionRefInput> = {}): CreateSessionRefInput {
  return {
    runtimeId: "claude",
    nativeSessionId: "native-1",
    workspaceRootPath: "/ws",
    ...overrides,
  };
}

describe("session binding + lifecycle", () => {
  it("creates a session ref with an immutable runtime binding and minted SpecOps id", () => {
    const ref = createSessionRef(baseInput({ runtimeId: "opencode", nativeSessionId: "oc-1" }));
    expect(ref.id).toBe("sos-session-1");
    expect(ref.runtimeId).toBe("opencode");
    expect(ref.native.runtimeId).toBe("opencode");
    expect(ref.native.nativeSessionId).toBe("oc-1");
    expect(ref.status).toBe("idle");
    expect(ref.capabilities).toEqual([]);
  });

  it("reuses a supplied SpecOps id and accepts a NativeSessionId brand", () => {
    const id = asSpecOpsSessionId("restored-1");
    const nativeSessionId = asNativeSessionId("native-2");
    const ref = createSessionRef(baseInput({ id, nativeSessionId }));
    expect(ref.id).toBe("restored-1");
    expect(ref.native.nativeSessionId).toBe("native-2");
  });

  it("rejects an unknown runtimeId and empty workspace root", () => {
    expect(() => createSessionRef(baseInput({ runtimeId: "gemini" as AgentRuntimeId }))).toThrow(
      SessionBindingError,
    );
    expect(() => createSessionRef(baseInput({ workspaceRootPath: "  " }))).toThrow(
      SessionBindingError,
    );
  });

  it("keeps runtime immutable: assertRuntimeImmutable throws on a different runtime", () => {
    const ref = createSessionRef(baseInput({ runtimeId: "claude" }));
    expect(() => assertRuntimeImmutable(ref, "claude")).not.toThrow();
    expect(() => assertRuntimeImmutable(ref, "codex")).toThrow(SessionBindingError);
  });

  it("rebindRuntime returns a NEW session id (changing runtime == new session) and links parent", () => {
    const original = createSessionRef(baseInput({ runtimeId: "claude", nativeSessionId: "c-1" }));
    const rebound = rebindRuntime(original, {
      runtimeId: "codex",
      nativeSessionId: "o-1",
      linkAsParent: true,
    });
    expect(rebound.id).not.toBe(original.id);
    expect(rebound.runtimeId).toBe("codex");
    expect(rebound.native.parentSessionId).toBe(original.id);
    expect(original.runtimeId).toBe("claude"); // original untouched
  });

  it("updateSessionRef preserves runtime/native and only patches mutable fields", () => {
    const ref = createSessionRef(baseInput({ runtimeId: "claude", status: "running" }));
    const updated = updateSessionRef(ref, { status: "completed", lastTurnAt: "2026-01-01T00:00:00.000Z" });
    expect(updated.runtimeId).toBe("claude");
    expect(updated.native).toBe(ref.native);
    expect(updated.status).toBe("completed");
    expect(updated.lastTurnAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("updateSessionRef refuses an embedded runtime change via assertRuntimeImmutable", () => {
    const ref = createSessionRef(baseInput({ runtimeId: "claude" }));
    expect(() =>
      updateSessionRef(ref, { runtimeId: "codex" as AgentRuntimeId } as never),
    ).toThrow(SessionBindingError);
  });

  it("rehydrateSessionRef rejects a runtimeId mismatch between session and native", () => {
    expect(() =>
      rehydrateSessionRef({
        id: "sos-session-1",
        runtimeId: "claude",
        native: { runtimeId: "codex", nativeSessionId: "n" },
        workspaceRootPath: "/ws",
        createdAt: "t",
        updatedAt: "t",
        status: "idle",
      }),
    ).toThrow(SessionBindingError);
  });

  it("classifies terminal lifecycle statuses", () => {
    for (const status of TERMINAL_SESSION_STATUSES) {
      expect(isTerminalSessionStatus(status)).toBe(true);
    }
    expect(isTerminalSessionStatus("running")).toBe(false);
    expect(isTerminalSessionStatus("idle")).toBe(false);
  });
});

// Ensure the SpecOps id counter is shared with the mint helper (smoke).
describe("session id minting", () => {
  it("mints monotonically after reset", () => {
    resetSessionIdCountersForTests();
    expect(mintSpecOpsSessionId()).toBe("sos-session-1");
    expect(mintSpecOpsSessionId()).toBe("sos-session-2");
  });
});
