import { describe, expect, it } from "vitest";
import {
  canStartRemoteGitOperation,
  isRemoteGitOperationBusy,
  isVersionControlToolbarBusy,
} from "./versionControlRemoteOps";

describe("versionControlRemoteOps", () => {
  const idle = { fetchBusy: false, pullBusy: false, pushBusy: false, refreshBusy: false };

  it("detects in-flight remote operations", () => {
    expect(isRemoteGitOperationBusy(idle)).toBe(false);
    expect(isRemoteGitOperationBusy({ ...idle, pushBusy: true })).toBe(true);
    expect(isRemoteGitOperationBusy({ ...idle, fetchBusy: true })).toBe(true);
    expect(isRemoteGitOperationBusy({ ...idle, pullBusy: true })).toBe(true);
  });

  it("blocks parallel remote operations while push is running", () => {
    expect(canStartRemoteGitOperation(idle)).toBe(true);
    expect(canStartRemoteGitOperation({ ...idle, pushBusy: true })).toBe(false);
    expect(canStartRemoteGitOperation({ ...idle, fetchBusy: true })).toBe(false);
  });

  it("blocks remote operations while refresh is running", () => {
    expect(canStartRemoteGitOperation({ ...idle, refreshBusy: true })).toBe(false);
  });

  it("blocks remote operations while remotes are loading", () => {
    expect(canStartRemoteGitOperation({ ...idle, remotesLoading: true })).toBe(false);
  });

  it("treats toolbar as busy when refresh or any remote op is active", () => {
    expect(isVersionControlToolbarBusy(idle)).toBe(false);
    expect(isVersionControlToolbarBusy({ ...idle, refreshBusy: true })).toBe(true);
    expect(isVersionControlToolbarBusy({ ...idle, pullBusy: true })).toBe(true);
  });
});
