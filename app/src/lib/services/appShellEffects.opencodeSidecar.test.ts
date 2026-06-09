import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachOpencodeSidecarWorkspace } from "./opencodeSidecar";
import { syncOpencodeSidecarEffect } from "./appShellEffects";

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
}));

const attachMock = vi.mocked(attachOpencodeSidecarWorkspace);

describe("syncOpencodeSidecarEffect", () => {
  beforeEach(() => {
    attachMock.mockClear();
  });

  it("attaches sidecar when workspace runtime is ready", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
    });

    expect(attachMock).toHaveBeenCalledWith("/tmp/workspace");
  });

  it("skips attach when chat-http is active", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: true,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: true,
    });

    expect(attachMock).not.toHaveBeenCalled();
  });

  it("skips attach when runtime is not ready", () => {
    syncOpencodeSidecarEffect({
      runtimeReady: false,
      activeWorkspaceRoot: "/tmp/workspace",
      isChatHttpActive: false,
    });

    expect(attachMock).not.toHaveBeenCalled();
  });
});
