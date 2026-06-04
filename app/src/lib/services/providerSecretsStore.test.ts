import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { loadProviderApiKey, saveProviderApiKey } from "./providerSecretsStore";

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

describe("providerSecretsStore", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("loads and trims the HTTP API key from the secrets file", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { http: "  secret-key  " } }),
    );

    await expect(loadProviderApiKey("http")).resolves.toBe("secret-key");
  });

  it("returns an empty key when the secrets file is missing or invalid", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(loadProviderApiKey("http")).resolves.toBe("");

    readTextFileMock.mockResolvedValue(JSON.stringify({ version: 2, keys: { http: "ignored" } }));
    await expect(loadProviderApiKey("http")).resolves.toBe("");
  });

  it("writes the HTTP API key to a provider-keyed secrets file", async () => {
    await saveProviderApiKey("http", "  secret-key  ");

    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify({ version: 1, keys: { http: "secret-key" } }, null, 2),
    );
  });

  it("merges keys for multiple providers without overwriting unrelated entries", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { http: "existing-http" } }),
    );

    await saveProviderApiKey("debug", "debug-key");

    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify(
        { version: 1, keys: { http: "existing-http", debug: "debug-key" } },
        null,
        2,
      ),
    );
  });

  it("removes a provider key when saving an empty string", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, keys: { http: "existing-http", debug: "debug-key" } }),
    );

    await saveProviderApiKey("http", "   ");

    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/provider-secrets.json",
      JSON.stringify({ version: 1, keys: { debug: "debug-key" } }, null, 2),
    );
  });
});
