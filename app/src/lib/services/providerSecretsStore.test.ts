import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { atomicWriteTextFile } from "./atomicWrite";
import {
  loadConnectionApiKey,
  loadConnectionApiKeys,
  saveConnectionApiKey,
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

describe("providerSecretsStore", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    atomicWriteTextFileMock.mockReset();
    atomicWriteTextFileMock.mockResolvedValue(undefined);
  });

  it("loads and trims the default connection API key from legacy http key", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { http: "  secret-key  " } }),
    );

    await expect(loadConnectionApiKey("default")).resolves.toBe("secret-key");
  });

  it("returns an empty key when the secrets file is missing or invalid", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(loadConnectionApiKey("default")).resolves.toBe("");

    readTextFileMock.mockResolvedValue(JSON.stringify({ version: 2, keys: { http: "ignored" } }));
    await expect(loadConnectionApiKey("default")).resolves.toBe("");
  });

  it("writes API key to a connection-keyed secrets file", async () => {
    await saveConnectionApiKey("conn-a", "  secret-key  ");

    expect(atomicWriteTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify({ version: 1, keys: { "conn-a": "secret-key" } }, null, 2),
    );
  });

  it("merges keys for multiple connections without overwriting unrelated entries", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { "conn-a": "existing-a" } }),
    );

    await saveConnectionApiKey("conn-b", "key-b");

    expect(atomicWriteTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify(
        { version: 1, keys: { "conn-a": "existing-a", "conn-b": "key-b" } },
        null,
        2,
      ),
    );
  });

  it("removes a connection key when saving an empty string", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { "conn-a": "existing-a", "conn-b": "key-b" } }),
    );

    await saveConnectionApiKey("conn-a", "   ");

    expect(atomicWriteTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify({ version: 1, keys: { "conn-b": "key-b" } }, null, 2),
    );
  });

  it("loads all keys and maps legacy http key to default", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { http: "legacy-key", "conn-x": "x-key" } }),
    );
    await expect(loadConnectionApiKeys()).resolves.toEqual({
      default: "legacy-key",
      http: "legacy-key",
      "conn-x": "x-key",
    });
  });
});
