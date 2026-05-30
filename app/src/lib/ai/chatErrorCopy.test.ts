import { describe, expect, it } from "vitest";
import { WorkspaceAccessReason } from "./capabilities";
import {
  DEBUG_PROVIDER_DISABLED_MESSAGE,
  DEBUG_PROVIDER_DISABLED_RECOVERY,
  GLM_MISSING_CONFIG_MESSAGE,
  GLM_MISSING_CONFIG_RECOVERY,
  PROVIDER_REQUEST_FAILURE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
  getAccessBlockedCopy,
  getDebugProviderDisabledCopy,
  getGlmMissingConfigCopy,
  getModeUnsupportedMessage,
  getModeUnsupportedRecovery,
  sanitizeUnexpectedProviderError,
} from "./chatErrorCopy";

describe("chatErrorCopy", () => {
  it("returns consistent workspace access blocked copy", () => {
    const copy = getAccessBlockedCopy(WorkspaceAccessReason.WorkspacePathInaccessible);

    expect(copy.title).toContain("cannot read files");
    expect(copy.message).toBe(WORKSPACE_PATH_INACCESSIBLE_MESSAGE);
    expect(copy.recoveryHint).toBe(WORKSPACE_PATH_INACCESSIBLE_RECOVERY);
  });

  it("returns generic missing config copy for access preflight", () => {
    const copy = getAccessBlockedCopy(WorkspaceAccessReason.MissingProviderConfig, {
      activeProvider: "glm",
    });

    expect(copy.message).not.toContain("GLM");
    expect(copy.recoveryHint).not.toContain("GLM");
  });

  it("returns provider setup copy for inline GLM and Debug blocked states", () => {
    expect(getGlmMissingConfigCopy().message).toBe(GLM_MISSING_CONFIG_MESSAGE);
    expect(getDebugProviderDisabledCopy().message).toBe(DEBUG_PROVIDER_DISABLED_MESSAGE);
    expect(getDebugProviderDisabledCopy().recoveryHint).toBe(DEBUG_PROVIDER_DISABLED_RECOVERY);
  });

  it("describes unsupported modes with recovery guidance", () => {
    expect(getModeUnsupportedMessage("review", "GLM")).toContain("review");
    expect(getModeUnsupportedRecovery()).toContain("Ask or Review");
  });

  it("sanitizes technical unexpected provider errors", () => {
    const stackError = new Error("TypeError: boom\n    at Object.<anonymous> (/tmp/x.js:1:1)");
    expect(sanitizeUnexpectedProviderError(stackError)).toBe(PROVIDER_REQUEST_FAILURE_MESSAGE);
    expect(sanitizeUnexpectedProviderError("not an error")).toBe(PROVIDER_REQUEST_FAILURE_MESSAGE);
  });
});
