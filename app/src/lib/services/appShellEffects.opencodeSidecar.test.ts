import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachOpencodeSidecarWorkspace,
  getOpencodeSidecarStatus,
  healthFromSidecarStatus,
  isOpencodeSidecarError,
  stopOpencodeSidecar,
} from "./opencodeSidecar";
import { requestOpencodeHealthRefresh, syncOpencodeSidecarEffect, syncOpencodeToggleEffect, probeUrlHealth } from "./appShellEffects";

vi.mock("./opencodeSidecar", () => ({
  attachOpencodeSidecarWorkspace: vi.fn().mockResolvedValue({
    running: true,
    baseUrl: "http://127.0.0.1:4096",
    health: "healthy",
    directory: "/tmp/workspace",
    port: 4096,
    pid: 42,
    lastError: null,
  }),
  getOpencodeSidecarStatus: vi.fn(),
  isOpencodeSidecarError: vi.fn().mockReturnValue(false),
  healthFromSidecarStatus: vi.fn().mockReturnValue("healthy"),
  stopOpencodeSidecar: vi.fn().mockResolvedValue({
    running: false,
    baseUrl: null,
    health: "unknown",
    directory: null,
    port: null,
    pid: null,
    lastError: null,
  }),
}));

vi.mock("./providerSecretsStore", () => ({
  loadOpencodeServerPassword: vi.fn().mockResolvedValue(""),
}));

const attachMock = vi.mocked(attachOpencodeSidecarWorkspace);
const getStatusMock = vi.mocked(getOpencodeSidecarStatus);
const mapHealthMock = vi.mocked(healthFromSidecarStatus);
const isSidecarErrorMock = vi.mocked(isOpencodeSidecarError);
const stopSidecarMock = vi.mocked(stopOpencodeSidecar);

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe("syncOpencodeSidecarEffect", () => {
  beforeEach(() => {
    attachMock.mockClear();
    getStatusMock.mockReset();
    mapHealthMock.mockReset();
    isSidecarErrorMock.mockReset();
    stopSidecarMock.mockReset();
    mapHealthMock.mockReturnValue("healthy");
    isSidecarErrorMock.mockReturnValue(false);
    vi.unstubAllGlobals();
  });

  it("attaches sidecar when workspace runtime is ready", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth: vi.fn(),
    });

    expect(attachMock).toHaveBeenCalledWith("/tmp/workspace");
  });

  it("publishes checking then mapped sidecar health on successful attach", async () => {
    mapHealthMock.mockReturnValue("degraded");
    const setOpencodeHealth = vi.fn();
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });

    await flushAsyncWork();

    expect(setOpencodeHealth).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "checking",
        source: "sidecar",
        lastErrorMessage: null,
      }),
    );
    expect(setOpencodeHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "degraded",
        source: "sidecar",
        lastErrorMessage: null,
      }),
    );
  });

  it("sets error health when sidecar attach fails with typed error", async () => {
    attachMock.mockRejectedValueOnce({
      kind: "launchFailure",
      message: "Unable to spawn sidecar",
    });
    isSidecarErrorMock.mockReturnValue(true);
    const setOpencodeHealth = vi.fn();

    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });

    await flushAsyncWork();

    expect(setOpencodeHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "error",
        source: "sidecar",
        lastErrorMessage: "Unable to spawn sidecar",
      }),
    );
  });

  it("skips attach when chat-http is active", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: true,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth: vi.fn(),
    });

    expect(attachMock).not.toHaveBeenCalled();
  });

  it("skips attach when workspace lifecycle has not started", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: false,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth: vi.fn(),
    });

    expect(attachMock).not.toHaveBeenCalled();
  });

  it("skips attach when runtime is not ready", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: false,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth: vi.fn(),
    });

    expect(attachMock).not.toHaveBeenCalled();
  });

  it("skips attach and resets health when opencode is disabled", () => {
    const setOpencodeHealth = vi.fn();
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: false,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });

    expect(attachMock).not.toHaveBeenCalled();
    expect(setOpencodeHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        source: null,
      }),
    );
  });

  it("validates URL mode and marks invalid URL as error", () => {
    const setOpencodeHealth = vi.fn();
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "url",
      opencodeBaseUrl: "://bad-url",
      setOpencodeHealth,
    });

    expect(setOpencodeHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "error",
        source: "url",
      }),
    );
  });

  it("marks URL mode degraded on non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );
    const setOpencodeHealth = vi.fn();
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      workspaceLifecycleActive: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
      opencodeEnabled: true,
      opencodeMode: "url",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });

    await flushAsyncWork();

    expect(setOpencodeHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "degraded",
        source: "url",
      }),
    );
  });
});

describe("requestOpencodeHealthRefresh", () => {
  beforeEach(() => {
    getStatusMock.mockReset();
    mapHealthMock.mockReset();
    mapHealthMock.mockReturnValue("healthy");
    isSidecarErrorMock.mockReset();
    isSidecarErrorMock.mockReturnValue(false);
    vi.unstubAllGlobals();
  });

  it("reads sidecar status and maps it into app health", async () => {
    getStatusMock.mockResolvedValueOnce({
      running: true,
      baseUrl: "http://127.0.0.1:4096",
      health: "healthy",
      directory: "/tmp/workspace",
      port: 4096,
      pid: 42,
      lastError: null,
    });
    mapHealthMock.mockReturnValueOnce("healthy");
    const setOpencodeHealth = vi.fn();

    requestOpencodeHealthRefresh({
      opencodeEnabled: true,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });
    await flushAsyncWork();

    expect(getStatusMock).toHaveBeenCalledTimes(1);
    expect(setOpencodeHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "healthy",
        source: "sidecar",
      }),
    );
  });

  it("marks URL refresh as healthy on 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }),
    );
    const setOpencodeHealth = vi.fn();

    requestOpencodeHealthRefresh({
      opencodeEnabled: true,
      opencodeMode: "url",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });
    await flushAsyncWork();

    expect(setOpencodeHealth).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "healthy",
        source: "url",
        lastErrorMessage: null,
      }),
    );
  });

  it("resets health when opencode is disabled", () => {
    const setOpencodeHealth = vi.fn();

    requestOpencodeHealthRefresh({
      opencodeEnabled: false,
      opencodeMode: "sidecar",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      setOpencodeHealth,
    });

    expect(getStatusMock).not.toHaveBeenCalled();
    expect(setOpencodeHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "unknown",
        source: null,
      }),
    );
  });
});

describe("probeUrlHealth", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns healthy on 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    const result = await probeUrlHealth("http://127.0.0.1:4096", "");
    expect(result.status).toBe("healthy");
    expect(result.message).toBeNull();
  });

  it("returns degraded with auth hint on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    const result = await probeUrlHealth("http://127.0.0.1:4096", "");
    expect(result.status).toBe("degraded");
    expect(result.message).toContain("Server password");
  });

  it("returns degraded without auth hint on 401 when password is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    const result = await probeUrlHealth("http://127.0.0.1:4096", "my-password");
    expect(result.status).toBe("degraded");
    expect(result.message).toContain("Server password");
  });

  it("returns degraded on other non-200 status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    const result = await probeUrlHealth("http://127.0.0.1:4096", "");
    expect(result.status).toBe("degraded");
    expect(result.message).toContain("503");
  });

  it("returns error for invalid URL", async () => {
    const result = await probeUrlHealth("://bad", "");
    expect(result.status).toBe("error");
  });

  it("returns error on timeout (AbortError)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }
        });
      }),
    );
    vi.useFakeTimers();
    const promise = probeUrlHealth("http://127.0.0.1:4096", "");
    vi.advanceTimersByTime(11_000);
    const result = await promise;
    vi.useRealTimers();
    expect(result.status).toBe("error");
    expect(result.message).toContain("timed out");
  });

  it("sends Authorization header when password is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await probeUrlHealth("http://127.0.0.1:4096", "secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });

  it("does not send Authorization header when password is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await probeUrlHealth("http://127.0.0.1:4096", "");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });
});

describe("requestOpencodeHealthRefresh URL auth", () => {
  beforeEach(() => {
    getStatusMock.mockReset();
    mapHealthMock.mockReset();
    mapHealthMock.mockReturnValue("healthy");
    isSidecarErrorMock.mockReset();
    isSidecarErrorMock.mockReturnValue(false);
    vi.unstubAllGlobals();
  });

  it("always triggers a fresh probe regardless of unchanged settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const setOpencodeHealth = vi.fn();

    requestOpencodeHealthRefresh({
      opencodeEnabled: true,
      opencodeMode: "url",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      serverPassword: "",
      setOpencodeHealth,
    });
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes server password to probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const setOpencodeHealth = vi.fn();

    requestOpencodeHealthRefresh({
      opencodeEnabled: true,
      opencodeMode: "url",
      opencodeBaseUrl: "http://127.0.0.1:4096",
      serverPassword: "test-pass",
      setOpencodeHealth,
    });
    await flushAsyncWork();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toMatch(/^Basic /);
  });
});

describe("syncOpencodeToggleEffect", () => {
  beforeEach(() => {
    stopSidecarMock.mockClear();
    stopSidecarMock.mockResolvedValue({
      running: false,
      baseUrl: null,
      health: "unknown",
      directory: null,
      port: null,
      pid: null,
      lastError: null,
    });
  });

  it("stops sidecar when opencode is disabled in sidecar mode", () => {
    syncOpencodeToggleEffect({
      runtimeReady: true,
      opencodeEnabled: false,
      opencodeMode: "sidecar",
    });
    expect(stopSidecarMock).toHaveBeenCalledTimes(1);
  });

  it("does not stop sidecar when opencode is enabled", () => {
    syncOpencodeToggleEffect({
      runtimeReady: true,
      opencodeEnabled: true,
      opencodeMode: "sidecar",
    });
    expect(stopSidecarMock).not.toHaveBeenCalled();
  });

  it("does not stop sidecar when runtime is not ready", () => {
    syncOpencodeToggleEffect({
      runtimeReady: false,
      opencodeEnabled: false,
      opencodeMode: "sidecar",
    });
    expect(stopSidecarMock).not.toHaveBeenCalled();
  });

  it("does not stop sidecar in url mode when disabled", () => {
    syncOpencodeToggleEffect({
      runtimeReady: true,
      opencodeEnabled: false,
      opencodeMode: "url",
    });
    expect(stopSidecarMock).not.toHaveBeenCalled();
  });
});
