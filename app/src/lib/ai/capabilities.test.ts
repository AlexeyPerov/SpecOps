import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceAccessReason,
  type CapabilityChecker,
  type CapabilityCheckResult,
} from "./capabilities";

describe("capabilities contract", () => {
  it("exposes stable workspace access reason codes", () => {
    expect(WorkspaceAccessReason.Unknown).toBe("unknown");
    expect(WorkspaceAccessReason.MissingProviderConfig).toBe("missing_provider_config");
    expect(WorkspaceAccessReason.WorkspacePathInaccessible).toBe("workspace_path_inaccessible");
    expect(WorkspaceAccessReason.ProviderUnsupported).toBe("provider_unsupported");
  });

  it("accepts checker implementations returning capability results", async () => {
    const checker: CapabilityChecker = {
      checkCapabilities: vi.fn().mockResolvedValue({
        status: "blocked",
        reason: WorkspaceAccessReason.ProviderUnsupported,
        capabilities: {
          canReadWorkspaceFiles: false,
          supportedModes: ["ask"],
        },
        message: "stub",
        recoveryHint: "later",
      } satisfies CapabilityCheckResult),
    };

    const result = await checker.checkCapabilities({
      provider: "http",
      mode: "ask",
      workspaceRootPath: "/work/a",
    });

    expect(result.status).toBe("blocked");
    expect(result.capabilities?.canReadWorkspaceFiles).toBe(false);
  });
});
