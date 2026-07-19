import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpencodeSessionFileDiff } from "./backends/workspaceAgentBackend";
import {
  clearSessionDiffs,
  getSessionDiffSnapshot,
  getSessionDiffs,
  refreshSessionDiffs,
  resetSessionDiffStoreForTests,
} from "./opencodeDiffStore";

const listSessionDiffsMock = vi.fn();

vi.mock("./backends/workspaceAgentBackend", () => ({
  createWorkspaceAgentBackend: vi.fn(() => ({
    listSessionDiffs: listSessionDiffsMock,
  })),
}));

vi.mock("./services/logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./backends/opencodeBackendFactory", () => ({
  createOpencodeBackendFromAppState: vi.fn(() => ({
    listSessionDiffs: listSessionDiffsMock,
  })),
}));

const WS = "/repo/ws";
const SESSION = "sess-a";

function diff(file: string): OpencodeSessionFileDiff {
  return { file, patch: "", additions: 1, deletions: 0, status: "added" };
}

function getStoreValue(readable: { subscribe: (cb: (v: unknown) => void) => () => void }): unknown {
  let current: unknown;
  const unsub = readable.subscribe((v) => {
    current = v;
  });
  unsub();
  return current;
}

beforeEach(() => {
  resetSessionDiffStoreForTests();
  listSessionDiffsMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("opencodeDiffStore — messageId cache isolation (M7-T2)", () => {
  it("caches scoped refreshes under separate stores keyed by messageId", async () => {
    listSessionDiffsMock
      .mockResolvedValueOnce([diff("a.ts")])
      .mockResolvedValueOnce([diff("b.ts")]);

    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-1" });
    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-2" });

    expect(getSessionDiffSnapshot(WS, SESSION, "msg-1").files.map((f) => f.file)).toEqual(["a.ts"]);
    expect(getSessionDiffSnapshot(WS, SESSION, "msg-2").files.map((f) => f.file)).toEqual(["b.ts"]);
  });

  it("isolates the whole-session (no messageId) scope from a messageId scope", async () => {
    listSessionDiffsMock
      .mockResolvedValueOnce([diff("all.ts")])
      .mockResolvedValueOnce([diff("scoped.ts")]);

    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION });
    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-1" });

    expect(getSessionDiffSnapshot(WS, SESSION).files.map((f) => f.file)).toEqual(["all.ts"]);
    expect(getSessionDiffSnapshot(WS, SESSION, "msg-1").files.map((f) => f.file)).toEqual([
      "scoped.ts",
    ]);
  });

  it("clearing one messageId scope leaves the others intact", async () => {
    listSessionDiffsMock
      .mockResolvedValueOnce([diff("a.ts")])
      .mockResolvedValueOnce([diff("b.ts")]);

    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-1" });
    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-2" });

    clearSessionDiffs(WS, SESSION, "msg-1");

    expect(getSessionDiffSnapshot(WS, SESSION, "msg-1").status).toBe("idle");
    expect(getSessionDiffSnapshot(WS, SESSION, "msg-2").files.map((f) => f.file)).toEqual(["b.ts"]);
  });
});

describe("opencodeDiffStore — inflight dedup honours messageId", () => {
  it("dedups concurrent refreshes of the same messageId", async () => {
    let resolveA: (value: OpencodeSessionFileDiff[]) => void = () => {};
    listSessionDiffsMock.mockImplementation(
      () => new Promise<OpencodeSessionFileDiff[]>((r) => (resolveA = r)),
    );

    const p1 = refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-1" });
    const p2 = refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-1" });

    expect(listSessionDiffsMock).toHaveBeenCalledTimes(1);

    resolveA([diff("a.ts")]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
  });

  it("runs concurrent messageId=A / messageId=B refreshes in parallel without cross-resolving", async () => {
    let resolveA: (value: OpencodeSessionFileDiff[]) => void = () => {};
    let resolveB: (value: OpencodeSessionFileDiff[]) => void = () => {};
    listSessionDiffsMock
      .mockImplementationOnce(
        () => new Promise<OpencodeSessionFileDiff[]>((r) => (resolveA = r)),
      )
      .mockImplementationOnce(
        () => new Promise<OpencodeSessionFileDiff[]>((r) => (resolveB = r)),
      );

    const pA = refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-a" });
    const pB = refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION, messageId: "msg-b" });

    expect(listSessionDiffsMock).toHaveBeenCalledTimes(2);

    // Resolve B first — A must still resolve to A's own files, not B's.
    resolveB([diff("from-b")]);
    const resultB = await pB;
    expect(resultB.files.map((f) => f.file)).toEqual(["from-b"]);

    resolveA([diff("from-a")]);
    const resultA = await pA;
    expect(resultA.files.map((f) => f.file)).toEqual(["from-a"]);
  });
});

describe("opencodeDiffStore — snapshot reflectiveness", () => {
  it("the reactive store reflects the snapshot value after a refresh", async () => {
    listSessionDiffsMock.mockResolvedValueOnce([diff("a.ts"), diff("b.ts")]);

    await refreshSessionDiffs({ workspaceRootPath: WS, sessionId: SESSION });

    const snapshot = getSessionDiffSnapshot(WS, SESSION);
    expect(snapshot.status).toBe("loaded");

    const storeValue = getStoreValue(getSessionDiffs(WS, SESSION)) as {
      status: string;
      files: OpencodeSessionFileDiff[];
    };
    expect(storeValue.status).toBe("loaded");
    expect(storeValue.files.map((f) => f.file)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("opencodeDiffStore — error degradation", () => {
  it("surfaces a backend failure as an error status with empty files", async () => {
    listSessionDiffsMock.mockRejectedValueOnce(new Error("boom"));

    const result = await refreshSessionDiffs({
      workspaceRootPath: WS,
      sessionId: SESSION,
      messageId: "msg-1",
    });

    expect(result.status).toBe("error");
    expect(result.files).toEqual([]);
    expect(result.lastErrorMessage).toBe("boom");
    expect(result.loadedAt).toBeNull();

    const snapshot = getSessionDiffSnapshot(WS, SESSION, "msg-1");
    expect(snapshot.status).toBe("error");
    expect(snapshot.lastErrorMessage).toBe("boom");
  });
});
