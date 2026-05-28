import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { loadGlmApiKey, saveGlmApiKey } from "./glmSecretsStore";

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

describe("glmSecretsStore", () => {
  beforeEach(() => {
    readTextFileMock.mockReset();
    writeTextFileMock.mockReset();
    writeTextFileMock.mockResolvedValue(undefined);
  });

  it("loads and trims the API key from the secrets file", async () => {
    readTextFileMock.mockResolvedValue(
      JSON.stringify({ version: 1, apiKey: "  secret-key  " }),
    );

    await expect(loadGlmApiKey()).resolves.toBe("secret-key");
  });

  it("returns an empty key when the secrets file is missing or invalid", async () => {
    readTextFileMock.mockRejectedValue(new Error("missing"));
    await expect(loadGlmApiKey()).resolves.toBe("");

    readTextFileMock.mockResolvedValue(JSON.stringify({ version: 2, apiKey: "ignored" }));
    await expect(loadGlmApiKey()).resolves.toBe("");
  });

  it("writes the API key to a dedicated secrets file", async () => {
    await saveGlmApiKey("  secret-key  ");

    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/data/spec-ops/glm-secrets.json",
      JSON.stringify({ version: 1, apiKey: "secret-key" }, null, 2),
    );
  });
});
