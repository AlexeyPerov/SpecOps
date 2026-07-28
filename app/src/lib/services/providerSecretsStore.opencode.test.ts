import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import {
  loadOpencodeServerPassword,
  OPENCODE_SERVER_PASSWORD_KEY,
  saveOpencodeServerPassword,
} from "./providerSecretsStore";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

vi.mock("./atomicWrite", () => ({
  atomicWriteTextFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const atomicWriteTextFileMock = vi.mocked(atomicWriteTextFile);

describe("providerSecretsStore OpenCode password", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    atomicWriteTextFileMock.mockReset();
    atomicWriteTextFileMock.mockResolvedValue(undefined);
  });

  it("loads password when present", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({
        version: 1,
        keys: {
          [OPENCODE_SERVER_PASSWORD_KEY]: "secret",
        },
      }),
    );
    await expect(loadOpencodeServerPassword()).resolves.toBe("secret");
  });

  it("returns empty string when secret file missing", async () => {
    readTextFileMock.mockRejectedValue(new Error("not found"));
    await expect(loadOpencodeServerPassword()).resolves.toBe("");
  });

  it("writes password when provided", async () => {
    readTextFileMock.mockResolvedValue(JSON.stringify({ version: 1, keys: {} }));
    atomicWriteTextFileMock.mockResolvedValue(undefined);
    await saveOpencodeServerPassword(" secret ");
    expect(atomicWriteTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify(
        {
          version: 1,
          keys: {
            [OPENCODE_SERVER_PASSWORD_KEY]: "secret",
          },
        },
        null,
        2,
      ),
    );
  });
});
