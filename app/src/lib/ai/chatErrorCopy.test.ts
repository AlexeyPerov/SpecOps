import { describe, expect, it } from "vitest";
import { WorkspaceAccessReason } from "./capabilities";
import {
  HTTP_RATE_LIMIT_FAILURE_MESSAGE,
  HTTP_RATE_LIMIT_FAILURE_RECOVERY,
  HTTP_UNAUTHORIZED_FAILURE_MESSAGE,
  HTTP_UNAUTHORIZED_FAILURE_RECOVERY,
  DEBUG_PROVIDER_DISABLED_MESSAGE,
  DEBUG_PROVIDER_DISABLED_RECOVERY,
  HTTP_MISSING_CONFIG_MESSAGE,
  HTTP_MISSING_CONFIG_RECOVERY,
  PROVIDER_REQUEST_FAILURE_MESSAGE,
  PROVIDER_REQUEST_FAILURE_RECOVERY,
  STREAM_CONNECTION_FAILURE_MESSAGE,
  STREAM_CONNECTION_FAILURE_RECOVERY,
  STREAM_PARSE_FAILURE_MESSAGE,
  STREAM_PARSE_FAILURE_RECOVERY,
  STREAM_TRUNCATED_FAILURE_MESSAGE,
  STREAM_TRUNCATED_FAILURE_RECOVERY,
  getProviderErrorRecoveryHint,
  WORKSPACE_PATH_INACCESSIBLE_MESSAGE,
  WORKSPACE_PATH_INACCESSIBLE_RECOVERY,
  getAccessBlockedCopy,
  getDebugProviderDisabledCopy,
  getHttpMissingConfigCopy,
  getLocalInvalidModelBlockedCopy,
  isComposerConfigurationError,
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
      activeProvider: "http",
    });

    expect(copy.message).not.toContain("HTTP");
    expect(copy.recoveryHint).not.toContain("HTTP");
  });

  it("returns provider setup copy for inline HTTP and Debug blocked states", () => {
    expect(getHttpMissingConfigCopy().message).toBe(HTTP_MISSING_CONFIG_MESSAGE);
    expect(getHttpMissingConfigCopy().recoveryHint).toBe(HTTP_MISSING_CONFIG_RECOVERY);
    expect(getDebugProviderDisabledCopy().message).toBe(DEBUG_PROVIDER_DISABLED_MESSAGE);
    expect(getDebugProviderDisabledCopy().recoveryHint).toBe(DEBUG_PROVIDER_DISABLED_RECOVERY);
  });

  it("returns local invalid model blocked copy for chat alarm state", () => {
    const copy = getLocalInvalidModelBlockedCopy("unknown-model", "HTTP");

    expect(copy.title).toBe("Model unavailable");
    expect(copy.message).toContain("unknown-model");
    expect(copy.message).toContain("HTTP");
    expect(copy.recoveryHint).toContain("Settings");
  });

  it("describes unsupported modes with recovery guidance", () => {
    expect(getModeUnsupportedMessage("review", "HTTP")).toContain("review");
    expect(getModeUnsupportedRecovery()).toContain("Ask or Review");
  });

  it("sanitizes technical unexpected provider errors", () => {
    const stackError = new Error("TypeError: boom\n    at Object.<anonymous> (/tmp/x.js:1:1)");
    expect(sanitizeUnexpectedProviderError(stackError)).toBe(PROVIDER_REQUEST_FAILURE_MESSAGE);
    expect(sanitizeUnexpectedProviderError("not an error")).toBe(PROVIDER_REQUEST_FAILURE_MESSAGE);
  });

  it("identifies composer configuration errors", () => {
    expect(isComposerConfigurationError("Select an agent to switch models.")).toBe(true);
    expect(isComposerConfigurationError("The assistant could not finish this response.")).toBe(false);
  });

  it("returns stream and auth specific recovery hints", () => {
    expect(getProviderErrorRecoveryHint(STREAM_CONNECTION_FAILURE_MESSAGE)).toBe(
      STREAM_CONNECTION_FAILURE_RECOVERY,
    );
    expect(getProviderErrorRecoveryHint(STREAM_PARSE_FAILURE_MESSAGE)).toBe(
      STREAM_PARSE_FAILURE_RECOVERY,
    );
    expect(getProviderErrorRecoveryHint(STREAM_TRUNCATED_FAILURE_MESSAGE)).toBe(
      STREAM_TRUNCATED_FAILURE_RECOVERY,
    );
    expect(getProviderErrorRecoveryHint(HTTP_UNAUTHORIZED_FAILURE_MESSAGE)).toBe(
      HTTP_UNAUTHORIZED_FAILURE_RECOVERY,
    );
    expect(getProviderErrorRecoveryHint(HTTP_RATE_LIMIT_FAILURE_MESSAGE)).toBe(
      HTTP_RATE_LIMIT_FAILURE_RECOVERY,
    );
    expect(getProviderErrorRecoveryHint("Some other provider error")).toBe(
      PROVIDER_REQUEST_FAILURE_RECOVERY,
    );
  });
});
