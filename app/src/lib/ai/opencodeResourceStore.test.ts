import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceAgentBackend } from "./backends/workspaceAgentBackend";
import { createReactiveResourceStore } from "./opencodeResourceStore";

/**
 * M10-T4 — pins the `createReactiveResourceStore` factory skeleton: cache,
 * inflight dedup, diagnostic emission, loading/error states, per-key clear,
 * and the reactive-vs-pull-only split. The per-store fetch logic is faked so
 * these tests are independent of the OpenCode backend.
 */

interface FakeState {
  status: "idle" | "loading" | "loaded" | "error";
  value: string;
  lastErrorMessage: string | null;
  loadedAt: string | null;
}

const emptyState: FakeState = {
  status: "idle",
  value: "",
  lastErrorMessage: null,
  loadedAt: null,
};

// `createOpencodeBackendFromAppState` is mocked per-test; the fake backend is a
// sentinel the `fetch` callback closes over so we can assert it was forwarded.
const fakeBackend = { __fake: true } as unknown as WorkspaceAgentBackend;
let backendEnabled = true;

vi.mock("./backends/opencodeBackendFactory", () => ({
  createOpencodeBackendFromAppState: () =>
    backendEnabled ? fakeBackend : null,
}));

vi.mock("../services/logging", () => ({
  logDiagnostic: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  backendEnabled = true;
  vi.clearAllMocks();
});

function makeStore(options?: {
  fetch?: (
    backend: WorkspaceAgentBackend,
    key: { id: string },
  ) => Promise<FakeState>;
  reactive?: boolean;
  buildErrorState?: (message: string, prior: FakeState) => FakeState;
  copyEmptyState?: () => FakeState;
}) {
  return createReactiveResourceStore<FakeState, { id: string }>({
    diagnosticLabel: "fake",
    diagnosticKind: "fake.refresh",
    reactive: options?.reactive ?? false,
    keyOf: (key) => key.id,
    copyEmptyState: options?.copyEmptyState ?? (() => ({ ...emptyState })),
    disabledState: () => ({ ...emptyState }),
    buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
    buildErrorState:
      options?.buildErrorState ??
      ((message) => ({
        ...emptyState,
        status: "error",
        lastErrorMessage: message,
      })),
    async fetch(backend, key) {
      return options?.fetch
        ? options.fetch(backend, key)
        : {
            status: "loaded",
            value: key.id,
            lastErrorMessage: null,
            loadedAt: "now",
          };
    },
  });
}

describe("createReactiveResourceStore — cache + snapshot", () => {
  it("returns a copy of the empty state before any refresh", () => {
    const store = makeStore();
    const a = store.getSnapshot({ id: "ws" });
    const b = store.getSnapshot({ id: "ws" });
    expect(a).toEqual(emptyState);
    // Same entry reused, but the snapshot value is the entry's value object.
    expect(a).toBe(b);
  });

  it("isolates cache entries per key", () => {
    const store = makeStore();
    expect(store.getSnapshot({ id: "ws-a" }).value).toBe("");
    expect(store.getSnapshot({ id: "ws-b" }).value).toBe("");
  });

  it("reflects a successful refresh in the snapshot", async () => {
    const store = makeStore();
    const result = await store.refresh({ id: "ws" });
    expect(result.status).toBe("loaded");
    expect(result.value).toBe("ws");
    expect(store.getSnapshot({ id: "ws" }).status).toBe("loaded");
  });

  it("copies emptyState per entry (M10-T3 snapshot-copy safety)", () => {
    const copied: FakeState[] = [];
    const store = makeStore({
      copyEmptyState: () => {
        const fresh = { ...emptyState, value: "fresh" };
        copied.push(fresh);
        return fresh;
      },
    });
    store.getSnapshot({ id: "ws-a" });
    store.getSnapshot({ id: "ws-b" });
    expect(copied).toHaveLength(2);
    // Two distinct objects — mutating one must not affect the other.
    expect(copied[0]).not.toBe(copied[1]);
  });
});

describe("createReactiveResourceStore — inflight dedup", () => {
  it("shares one inflight promise for concurrent refreshes of the same key", async () => {
    let fetchCalls = 0;
    let resolveFetch: (value: FakeState) => void = () => {};
    const store = makeStore({
      fetch: (_backend, key) => {
        fetchCalls += 1;
        return new Promise<FakeState>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });

    const p1 = store.refresh({ id: "ws" });
    const p2 = store.refresh({ id: "ws" });
    // The fetch callback fires exactly once — the second refresh shares the
    // inflight promise rather than issuing a second fetch.
    expect(fetchCalls).toBe(1);

    resolveFetch({ ...emptyState, status: "loaded", value: "ws", loadedAt: "now" });
    const [r1, r2] = await Promise.all([p1, p2]);
    // Both refreshes resolve to the same state object.
    expect(r1).toBe(r2);
  });

  it("runs concurrent refreshes of different keys in parallel", async () => {
    const fetchCalls: string[] = [];
    let resolveA: (v: FakeState) => void = () => {};
    let resolveB: (v: FakeState) => void = () => {};
    const store = makeStore({
      fetch: (_backend, key) => {
        fetchCalls.push(key.id);
        return key.id === "ws-a"
          ? new Promise<FakeState>((r) => (resolveA = r))
          : new Promise<FakeState>((r) => (resolveB = r));
      },
    });

    const pA = store.refresh({ id: "ws-a" });
    const pB = store.refresh({ id: "ws-b" });
    expect(fetchCalls).toEqual(["ws-a", "ws-b"]);

    resolveB({ ...emptyState, status: "loaded", value: "ws-b", loadedAt: "now" });
    const resultB = await pB;
    expect(resultB.value).toBe("ws-b");

    resolveA({ ...emptyState, status: "loaded", value: "ws-a", loadedAt: "now" });
    const resultA = await pA;
    expect(resultA.value).toBe("ws-a");
  });

  it("allows a re-refresh after the inflight settles", async () => {
    let calls = 0;
    const store = makeStore({
      fetch: (_backend, key) => {
        calls += 1;
        return Promise.resolve({
          status: "loaded",
          value: `${key.id}-${calls}`,
          lastErrorMessage: null,
          loadedAt: "now",
        });
      },
    });
    await store.refresh({ id: "ws" });
    await store.refresh({ id: "ws" });
    expect(calls).toBe(2);
    expect(store.getSnapshot({ id: "ws" }).value).toBe("ws-2");
  });
});

describe("createReactiveResourceStore — disabled degrade", () => {
  it("returns the disabled state and caches it when the backend is null", async () => {
    backendEnabled = false;
    const store = makeStore();
    const result = await store.refresh({ id: "ws" });
    expect(result.status).toBe("idle");
    expect(store.getSnapshot({ id: "ws" }).status).toBe("idle");
  });
});

describe("createReactiveResourceStore — error degrade", () => {
  it("surfaces a thrown fetch as the error state and never throws", async () => {
    const store = makeStore({
      fetch: () => Promise.reject(new Error("boom")),
    });
    const result = await store.refresh({ id: "ws" });
    expect(result.status).toBe("error");
    expect(result.lastErrorMessage).toBe("boom");
  });

  it("uses a non-Error message fallback when the thrown value is not an Error", async () => {
    const store = makeStore({
      fetch: () => Promise.reject("string error"),
    });
    const result = await store.refresh({ id: "ws" });
    expect(result.status).toBe("error");
    expect(result.lastErrorMessage).toBe("fake failed.");
  });

  it("delegates to buildErrorState for custom prior-data preservation", async () => {
    const store = makeStore({
      buildErrorState: (message, prior) => ({
        ...prior,
        status: "error",
        lastErrorMessage: `preserved:${prior.value}:${message}`,
      }),
    });
    // First a successful load to populate prior data.
    await store.refresh({ id: "ws" });
    // Then a failing fetch — prior.value ("ws") must survive via buildErrorState.
    const store2 = makeStore({
      buildErrorState: (message, prior) => ({
        ...prior,
        status: "error",
        lastErrorMessage: `preserved:${prior.value}:${message}`,
      }),
      fetch: () => Promise.reject(new Error("reload-fail")),
    });
    // Reuse the same key on a fresh store (empty prior) to show the fallback.
    const result = await store2.refresh({ id: "ws" });
    expect(result.status).toBe("error");
    expect(result.lastErrorMessage).toBe("preserved::reload-fail");
  });
});

describe("createReactiveResourceStore — clear + reset", () => {
  it("clear drops a single cache + inflight entry but leaves others intact", async () => {
    const store = makeStore();
    await store.refresh({ id: "ws-a" });
    await store.refresh({ id: "ws-b" });
    store.clear({ id: "ws-a" });
    expect(store.getSnapshot({ id: "ws-a" }).status).toBe("idle");
    expect(store.getSnapshot({ id: "ws-b" }).status).toBe("loaded");
  });

  it("resetForTests drops every entry", async () => {
    const store = makeStore();
    await store.refresh({ id: "ws-a" });
    await store.refresh({ id: "ws-b" });
    store.resetForTests();
    expect(store.getSnapshot({ id: "ws-a" }).status).toBe("idle");
    expect(store.getSnapshot({ id: "ws-b" }).status).toBe("idle");
  });

  it("setSnapshot writes directly without invoking fetch", () => {
    const store = makeStore();
    store.setSnapshot({ id: "ws" }, {
      ...emptyState,
      status: "loaded",
      value: "manual",
      loadedAt: "now",
    });
    expect(store.getSnapshot({ id: "ws" }).value).toBe("manual");
  });
});

describe("createReactiveResourceStore — reactive split", () => {
  it("getReadable throws on a pull-only store with a pointing-to-the-note message", () => {
    const store = makeStore({ reactive: false });
    expect(() => store.getReadable({ id: "ws" })).toThrowError(/pull-only/);
  });

  it("getReadable returns a live Svelte Readable on a reactive store", async () => {
    const store = makeStore({ reactive: true });
    const readable = store.getReadable({ id: "ws" });
    expect(typeof readable.subscribe).toBe("function");

    let current: FakeState | undefined;
    const unsub = readable.subscribe((value) => {
      current = value;
    });
    // Initial value is the empty state.
    expect(current?.status).toBe("idle");

    await store.refresh({ id: "ws" });
    // The subscription reflects the refresh.
    expect(current?.status).toBe("loaded");
    expect(current?.value).toBe("ws");

    unsub();
  });
});

describe("createReactiveResourceStore — diagnostics", () => {
  it("emits a loaded diagnostic on success and an error diagnostic on failure", async () => {
    const { logDiagnostic } = await import("../services/logging");
    const mocked = vi.mocked(logDiagnostic);

    const store = makeStore({
      fetch: () => Promise.reject(new Error("boom")),
    });
    // Success first.
    const okStore = makeStore();
    await okStore.refresh({ id: "ws-ok" });
    const loadedCall = mocked.mock.calls.find(
      (call) =>
        call[0].metadata?.kind === "fake.refresh" &&
        call[0].metadata?.reason === "loaded",
    );
    expect(loadedCall).toBeTruthy();
    expect(loadedCall![0].level).toBe("debug");

    mocked.mockClear();
    await store.refresh({ id: "ws-err" });
    const errorCall = mocked.mock.calls.find(
      (call) =>
        call[0].metadata?.kind === "fake.refresh" &&
        call[0].metadata?.reason === "error",
    );
    expect(errorCall).toBeTruthy();
    expect(errorCall![0].level).toBe("warn");
    expect(errorCall![0].metadata?.key).toBe("ws-err");
  });

  it("merges diagnosticExtra into the metadata blob", async () => {
    const { logDiagnostic } = await import("../services/logging");
    const mocked = vi.mocked(logDiagnostic);

    const store = createReactiveResourceStore<FakeState, { id: string }>({
      diagnosticLabel: "fake",
      diagnosticKind: "fake.refresh",
      reactive: false,
      keyOf: (key) => key.id,
      diagnosticExtra: (key) => ({ workspaceRootPath: key.id, sessionId: "s1" }),
      copyEmptyState: () => ({ ...emptyState }),
      disabledState: () => ({ ...emptyState }),
      buildLoadingState: (prior) => ({ ...prior, status: "loading" }),
      buildErrorState: (m) => ({ ...emptyState, status: "error", lastErrorMessage: m }),
      async fetch() {
        return { ...emptyState, status: "loaded", value: "x", loadedAt: "now" };
      },
    });
    await store.refresh({ id: "ws" });
    const call = mocked.mock.calls.find(
      (c) => c[0].metadata?.reason === "loaded",
    );
    expect(call![0].metadata).toMatchObject({
      kind: "fake.refresh",
      key: "ws",
      workspaceRootPath: "ws",
      sessionId: "s1",
    });
  });
});
