import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  attachOpencodeSidecarWorkspace,
  getOpencodeSidecarStatus,
  isOpencodeSidecarError,
  restartOpencodeSidecar,
  startOpencodeSidecar,
  stopOpencodeSidecar,
  type OpencodeSidecarStatus,
} from "./opencodeSidecar";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const sampleStatus: OpencodeSidecarStatus = {
  running: true,
  baseUrl: "http://127.0.0.1:4096",
  health: "healthy",
  directory: "/tmp/workspace",
  port: 4096,
  pid: 1234,
  lastError: null,
};

describe("opencodeSidecar", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(sampleStatus);
  });

  it("attachOpencodeSidecarWorkspace invokes attach command", async () => {
    await attachOpencodeSidecarWorkspace("/tmp/workspace");

    expect(invokeMock).toHaveBeenCalledWith("opencode_sidecar_attach_workspace", {
      directory: "/tmp/workspace",
    });
  });

  it("startOpencodeSidecar invokes start command", async () => {
    await startOpencodeSidecar("/tmp/workspace");

    expect(invokeMock).toHaveBeenCalledWith("opencode_sidecar_start", {
      directory: "/tmp/workspace",
    });
  });

  it("stopOpencodeSidecar invokes stop command", async () => {
    await stopOpencodeSidecar();

    expect(invokeMock).toHaveBeenCalledWith("opencode_sidecar_stop");
  });

  it("restartOpencodeSidecar invokes restart command", async () => {
    await restartOpencodeSidecar("/tmp/workspace");

    expect(invokeMock).toHaveBeenCalledWith("opencode_sidecar_restart", {
      directory: "/tmp/workspace",
    });
  });

  it("getOpencodeSidecarStatus invokes status command", async () => {
    await getOpencodeSidecarStatus();

    expect(invokeMock).toHaveBeenCalledWith("opencode_sidecar_status");
  });

  it("isOpencodeSidecarError recognizes typed sidecar errors", () => {
    expect(
      isOpencodeSidecarError({
        kind: "portInUse",
        port: 4096,
        message: "Port in use",
      }),
    ).toBe(true);
    expect(isOpencodeSidecarError("launch failure")).toBe(false);
  });
});
