import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachOpencodeSidecarWorkspace,
  getOpencodeSidecarStatus,
  type OpencodeSidecarStatus,
} from "./opencodeSidecar";
import {
  clearOpencodeSidecarCircuitBreaker,
  ensureOpencodeSidecar,
  getOpencodeSidecarLastFailureSignature,
  isOpencodeSidecarBlocked,
  resetOpencodeSidecarEnsureForTests,
} from "./opencodeSidecarEnsure";

vi.mock("./opencodeSidecar", () => ({
  attachOpencodeSidecarWorkspace: vi.fn(),
  getOpencodeSidecarStatus: vi.fn(),
  isOpencodeSidecarError: vi.fn(
    (value: unknown): boolean =>
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      typeof (value as { kind: unknown }).kind === "string",
  ),
}));

const attachMock = vi.mocked(attachOpencodeSidecarWorkspace);
const statusMock = vi.mocked(getOpencodeSidecarStatus);

const healthyStatus: OpencodeSidecarStatus = {
  running: true,
  baseUrl: "http://127.0.0.1:4096",
  health: "healthy",
  directory: "/tmp/workspace",
  port: 4096,
  pid: 42,
  lastError: null,
};

const checkingStatus: OpencodeSidecarStatus = {
  ...healthyStatus,
  health: "checking",
};

const portInUseError = {
  kind: "portInUse",
  port: 4096,
  message: "Port 4096 is already in use by another process",
} as const;

const portInUseStatus: OpencodeSidecarStatus = {
  running: false,
  baseUrl: null,
  health: "error",
  directory: null,
  port: null,
  pid: null,
  lastError: portInUseError,
};

describe("ensureOpencodeSidecar", () => {
  beforeEach(() => {
    resetOpencodeSidecarEnsureForTests();
    attachMock.mockReset();
    statusMock.mockReset();
  });

  afterEach(() => {
    resetOpencodeSidecarEnsureForTests();
  });

  it("spawns the sidecar on first send intent and returns healthy status", async () => {
    attachMock.mockResolvedValueOnce(healthyStatus);
    const result = await ensureOpencodeSidecar({
      intent: "send",
      directory: "/tmp/workspace",
    });
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: healthyStatus, spawned: true });
    expect(isOpencodeSidecarBlocked()).toBe(false);
  });

  it("shares one attach promise across concurrent send calls (single-flight)", async () => {
    let resolveAttach!: (value: OpencodeSidecarStatus) => void;
    attachMock.mockImplementationOnce(
      () =>
        new Promise<OpencodeSidecarStatus>((resolve) => {
          resolveAttach = resolve;
        }),
    );
    const first = ensureOpencodeSidecar({ intent: "send", directory: "/ws" });
    const second = ensureOpencodeSidecar({ intent: "send", directory: "/ws" });
    resolveAttach(healthyStatus);
    const [a, b] = await Promise.all([first, second]);
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(a?.status.health).toBe("healthy");
    expect(b?.status.health).toBe("healthy");
  });

  it("trips the breaker on portInUse and blocks subsequent background-sync calls", async () => {
    attachMock.mockRejectedValueOnce(portInUseError);
    const first = await ensureOpencodeSidecar({ intent: "send", directory: "/ws" });
    expect(first?.status.lastError?.kind).toBe("portInUse");
    expect(isOpencodeSidecarBlocked()).toBe(true);
    expect(getOpencodeSidecarLastFailureSignature()).toBe(
      "portInUse:Port 4096 is already in use by another process",
    );

    // background-sync intent returns null without invoking attach again.
    const second = await ensureOpencodeSidecar({
      intent: "background-sync",
      directory: "/ws",
    });
    expect(second).toBeNull();
    expect(attachMock).toHaveBeenCalledTimes(1);
  });

  it("settings intent clears the breaker and re-attempts", async () => {
    attachMock.mockRejectedValueOnce(portInUseError);
    await ensureOpencodeSidecar({ intent: "send", directory: "/ws" });
    expect(isOpencodeSidecarBlocked()).toBe(true);

    clearOpencodeSidecarCircuitBreaker();
    expect(isOpencodeSidecarBlocked()).toBe(false);

    attachMock.mockResolvedValueOnce(healthyStatus);
    const result = await ensureOpencodeSidecar({
      intent: "settings",
      directory: "/ws",
    });
    expect(result?.status.health).toBe("healthy");
    expect(attachMock).toHaveBeenCalledTimes(2);
  });

  it("settings intent always re-attempts even with breaker active", async () => {
    attachMock.mockRejectedValueOnce(portInUseError);
    await ensureOpencodeSidecar({ intent: "send", directory: "/ws" });
    expect(isOpencodeSidecarBlocked()).toBe(true);

    attachMock.mockResolvedValueOnce(healthyStatus);
    const result = await ensureOpencodeSidecar({
      intent: "settings",
      directory: "/ws",
    });
    expect(result?.status.health).toBe("healthy");
    expect(isOpencodeSidecarBlocked()).toBe(false);
  });

  it("status-only intent returns null when sidecar isn't running", async () => {
    statusMock.mockResolvedValueOnce({
      ...healthyStatus,
      running: false,
      baseUrl: null,
    });
    const result = await ensureOpencodeSidecar({
      intent: "status-only",
      directory: "/ws",
    });
    expect(result).toBeNull();
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("status-only intent returns status when sidecar is healthy", async () => {
    statusMock.mockResolvedValueOnce(healthyStatus);
    const result = await ensureOpencodeSidecar({
      intent: "status-only",
      directory: "/ws",
    });
    expect(result?.status.health).toBe("healthy");
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("background-sync intent returns null when sidecar isn't running", async () => {
    statusMock.mockResolvedValueOnce({
      ...healthyStatus,
      running: false,
      baseUrl: null,
    });
    const result = await ensureOpencodeSidecar({
      intent: "background-sync",
      directory: "/ws",
    });
    expect(result).toBeNull();
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("waits for health to settle after a checking attach", async () => {
    attachMock.mockResolvedValueOnce(checkingStatus);
    statusMock.mockResolvedValueOnce(healthyStatus);
    const result = await ensureOpencodeSidecar({
      intent: "send",
      directory: "/ws",
    });
    expect(result?.status.health).toBe("healthy");
    expect(statusMock).toHaveBeenCalled();
  });

  it("trips the breaker when health settles into a hard failure", async () => {
    attachMock.mockResolvedValueOnce(checkingStatus);
    statusMock.mockResolvedValueOnce(portInUseStatus);
    const result = await ensureOpencodeSidecar({
      intent: "send",
      directory: "/ws",
    });
    expect(result?.status.health).toBe("error");
    expect(isOpencodeSidecarBlocked()).toBe(true);
  });
});