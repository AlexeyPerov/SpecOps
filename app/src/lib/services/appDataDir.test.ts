import { beforeEach, describe, expect, it, vi } from "vitest";

const mkdirMock = vi.fn();
const appDataDirMock = vi.fn();
const joinMock = vi.fn();

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (...args: unknown[]) => mkdirMock(...args),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: (...args: unknown[]) => appDataDirMock(...args),
  join: (...args: unknown[]) => joinMock(...args),
}));

import { ensureSpecOpsDataDir, resetSpecOpsDataDirForTests } from "./appDataDir";

describe("ensureSpecOpsDataDir", () => {
  beforeEach(() => {
    resetSpecOpsDataDirForTests();
    mkdirMock.mockReset();
    appDataDirMock.mockReset();
    joinMock.mockReset();
    appDataDirMock.mockResolvedValue("/data");
    joinMock.mockResolvedValue("/data/spec-ops");
    mkdirMock.mockResolvedValue(undefined);
  });

  it("creates the data dir once and reuses the cached path", async () => {
    await expect(ensureSpecOpsDataDir()).resolves.toBe("/data/spec-ops");
    await expect(ensureSpecOpsDataDir()).resolves.toBe("/data/spec-ops");
    expect(mkdirMock).toHaveBeenCalledTimes(1);
  });

  it("retries after a rejected mkdir instead of caching the failure", async () => {
    mkdirMock.mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined);

    await expect(ensureSpecOpsDataDir()).rejects.toThrow("transient");
    await expect(ensureSpecOpsDataDir()).resolves.toBe("/data/spec-ops");
    expect(mkdirMock).toHaveBeenCalledTimes(2);
  });
});
