import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  loadOpencodeServerPassword,
  OPENCODE_SERVER_PASSWORD_KEY,
  saveOpencodeServerPassword,
} from "./providerSecretsStore";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("./appDataDir", () => ({
  ensureSpecOpsDataDir: vi.fn().mockResolvedValue("/data/spec-ops"),
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: (...parts: string[]) => parts.join("/"),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

describe("providerSecretsStore OpenCode password", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
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
    writeTextFileMock.mockResolvedValue(undefined);
    await saveOpencodeServerPassword(" secret ");
    expect(writeTextFileMock).toHaveBeenCalledWith(
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
